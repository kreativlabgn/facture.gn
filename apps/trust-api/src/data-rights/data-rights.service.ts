import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import type { $Enums, DataRightsRequestOutcome, Prisma, PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../common/prisma.module";
import { CUSTOMER_NAME_TOMBSTONE, isRetainedInvoice, retentionExpiryOf } from "./anonymization";
import {
  hashMsisdn,
  normalizeMsisdn,
  type SubjectDataExport,
  type SubjectCustomerRecord,
} from "./subject-data";

type TxClient = Prisma.TransactionClient;

interface AnonymizationApplied {
  outcome: Extract<DataRightsRequestOutcome, "completed" | "partial">;
  note: string | null;
  retentionExpiry: Date | null;
}

export interface AnonymizationResult {
  outcome: DataRightsRequestOutcome;
  retentionExpiry: Date | null;
  affectedCustomerIds: string[];
}

const RETENTION_INVOICE_SELECT = {
  documentType: true,
  status: true,
  issuedAt: true,
} as const;

type RetentionInvoiceRow = {
  documentType: $Enums.InvoiceDocumentType;
  status: $Enums.InvoiceStatus;
  issuedAt: Date | null;
};

// J2, ADR-116 — droit d'accès (export) et droit à l'effacement (anonymisation).
// Le service fait ses propres requêtes Prisma (aucune dépendance vers
// CustomersModule). Toute opération écrit une ligne immuable dans
// `data_rights_request` (registre de responsabilité opposable au régulateur PDP).
//
// `organizationId` non nul = chemin PME (RolesGuard a déjà vérifié que l'appelant
// est owner/admin de cette organisation) → tout est scopé à cette organisation,
// le bloc compte `User` n'est JAMAIS renvoyé (hors périmètre J2 + fuite
// inter-tenant). `organizationId` nul = chemin ops plateforme (clé interne
// dédiée) → transverse, bloc compte inclus.
@Injectable()
export class DataRightsService {
  private readonly subjectHashPepper: string;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {
    this.subjectHashPepper = process.env.DATA_RIGHTS_SUBJECT_HASH_PEPPER ?? "";
  }

  // normalizeMsisdn est pur (lève un Error nu) — le traduire en 400 propre.
  private toCanonical(phone: string): string {
    try {
      return normalizeMsisdn(phone);
    } catch {
      throw new BadRequestException("numéro de téléphone guinéen invalide");
    }
  }

  /** HMAC keyed du numéro — lève si le pepper n'est pas configuré. */
  private subjectHash(canonical: string): string {
    return hashMsisdn(canonical, this.subjectHashPepper);
  }

  async exportSubjectData(params: {
    phone: string;
    organizationId: string | null;
    requestedByUserId?: string;
  }): Promise<SubjectDataExport> {
    const canonical = this.toCanonical(params.phone);
    const subjectPhoneHash = this.subjectHash(canonical);
    const viaOps = params.organizationId === null;

    const customers = await this.prisma.customer.findMany({
      where: {
        phone: canonical,
        ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      },
      include: {
        invoices: {
          select: {
            number: true,
            certificationId: true,
            documentType: true,
            status: true,
            disputeStatus: true,
            issuedAt: true,
            totalTtc: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Chemin PME : refuser un numéro sans aucun client dans l'organisation
    // (jamais un oracle d'énumération, jamais de ligne de registre polluante).
    if (!viaOps && customers.length === 0) {
      throw new NotFoundException("Aucun client de cette organisation ne correspond à ce numéro");
    }

    const customerRecords: SubjectCustomerRecord[] = customers.map((c) => ({
      customerId: c.id,
      organizationId: c.organizationId,
      name: c.name,
      phone: c.phone,
      nif: c.nif,
      notificationChannel: c.notificationChannel,
      anonymizedAt: c.anonymizedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      invoices: c.invoices.map((i) => ({
        number: i.number,
        certificationId: i.certificationId,
        documentType: i.documentType,
        status: i.status,
        disputeStatus: i.disputeStatus,
        issuedAt: i.issuedAt?.toISOString() ?? null,
        totalTtc: i.totalTtc.toString(),
      })),
    }));

    // Bloc compte `User` : chemin OPS uniquement (transverse par nature), et
    // seulement sur un numéro VÉRIFIÉ (verifiedAt) — même exigence d'identité que
    // le portail client (ADR-087/096). `select` explicite : passwordHash/pinHash
    // ne sont jamais chargés en mémoire.
    let account = null;
    if (viaOps) {
      const userPhone = await this.prisma.userPhone.findFirst({
        where: { msisdn: canonical, verifiedAt: { not: null } },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              preferredLanguage: true,
              phones: { select: { msisdn: true } },
            },
          },
        },
      });
      account = userPhone
        ? {
            userId: userPhone.user.id,
            name: userPhone.user.name,
            preferredLanguage: userPhone.user.preferredLanguage,
            phones: userPhone.user.phones.map((p) => p.msisdn),
          }
        : null;
    }

    await this.prisma.dataRightsRequest.create({
      data: {
        kind: "access",
        outcome: "completed",
        subjectPhoneHash,
        requestedByUserId: params.requestedByUserId ?? null,
        viaOps,
        organizationId: params.organizationId,
        affectedCustomerIds: customerRecords.map((c) => c.customerId),
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      subjectPhoneHash,
      scope: viaOps ? "platform" : "organization",
      customers: customerRecords,
      account,
    };
  }

  /**
   * Anonymise UN client par son id (chemin PME). Dans la transaction :
   * lecture minimale (org + téléphone) pour la clé de verrou → verrou consultatif
   * (même clé que `CustomersService.create()`, E3) → **re-lecture** du client
   * sous verrou → effacement des colonnes PII → écriture du registre. La
   * re-lecture ferme la fenêtre où une anonymisation concurrente (ou une
   * création) commiterait entre la 1ʳᵉ lecture et le verrou.
   */
  async anonymizeCustomerById(
    customerId: string,
    ctx: { requestedByUserId: string | null; viaOps: boolean },
  ): Promise<AnonymizationResult> {
    return this.prisma.$transaction(async (tx) => {
      const stub = await tx.customer.findUnique({
        where: { id: customerId },
        select: { organizationId: true, phone: true },
      });
      if (!stub) {
        throw new NotFoundException(`Client ${customerId} introuvable`);
      }

      await this.lockDedupKey(tx, stub.organizationId, stub.phone);
      const customer = await this.readCustomerForAnonymization(tx, customerId);

      const applied = await this.applyAnonymization(tx, customer);

      await tx.dataRightsRequest.create({
        data: {
          kind: "anonymization",
          outcome: applied.outcome,
          subjectPhoneHash: customer.phone ? this.subjectHash(customer.phone) : null,
          requestedByUserId: ctx.requestedByUserId,
          viaOps: ctx.viaOps,
          organizationId: customer.organizationId,
          affectedCustomerIds: [customer.id],
          note: applied.note,
        },
      });

      return {
        outcome: applied.outcome,
        retentionExpiry: applied.retentionExpiry,
        affectedCustomerIds: [customer.id],
      };
    });
  }

  /**
   * Anonymise TOUS les clients d'un numéro (chemin ops plateforme, transverse ou
   * scopé). Une transaction, un seul enregistrement de registre agrégé. Chaque
   * client est re-lu sous son verrou avant traitement.
   */
  async anonymizeSubjectByPhone(params: {
    phone: string;
    organizationId: string | null;
    requestedByUserId?: string;
  }): Promise<AnonymizationResult> {
    const canonical = this.toCanonical(params.phone);
    const subjectPhoneHash = this.subjectHash(canonical);
    const viaOps = params.organizationId === null;

    const matches = await this.prisma.customer.findMany({
      where: {
        phone: canonical,
        ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      },
      select: { id: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const outcomes: AnonymizationApplied["outcome"][] = [];
      const affectedCustomerIds: string[] = [];
      let retentionExpiry: Date | null = null;

      for (const { id } of matches) {
        const stub = await tx.customer.findUnique({
          where: { id },
          select: { organizationId: true, phone: true },
        });
        if (!stub) continue;
        await this.lockDedupKey(tx, stub.organizationId, stub.phone ?? canonical);
        const customer = await this.readCustomerForAnonymization(tx, id);

        const applied = await this.applyAnonymization(tx, customer);
        outcomes.push(applied.outcome);
        affectedCustomerIds.push(id);
        if (applied.retentionExpiry && (!retentionExpiry || applied.retentionExpiry > retentionExpiry)) {
          retentionExpiry = applied.retentionExpiry;
        }
      }

      const outcome: DataRightsRequestOutcome =
        affectedCustomerIds.length === 0 ? "failed" : outcomes.includes("partial") ? "partial" : "completed";

      await tx.dataRightsRequest.create({
        data: {
          kind: "anonymization",
          outcome,
          subjectPhoneHash,
          requestedByUserId: params.requestedByUserId ?? null,
          viaOps,
          organizationId: params.organizationId,
          affectedCustomerIds,
          note: retentionExpiry ? `name/nif conservés jusqu'à ${retentionExpiry.toISOString()}` : null,
        },
      });

      return { outcome, retentionExpiry, affectedCustomerIds };
    });
  }

  private async readCustomerForAnonymization(
    tx: TxClient,
    customerId: string,
  ): Promise<{ id: string; organizationId: string; phone: string | null; anonymizedAt: Date | null; invoices: RetentionInvoiceRow[] }> {
    // Le client a déjà été vu juste avant le verrou (findUnique du stub) — il ne
    // peut pas disparaître (append-only sur invoice, delete customer = seulement
    // merge() qui prendrait le même verrou). findUniqueOrThrow par sécurité.
    return tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        id: true,
        organizationId: true,
        phone: true,
        anonymizedAt: true,
        invoices: { select: RETENTION_INVOICE_SELECT },
      },
    });
  }

  private async lockDedupKey(tx: TxClient, organizationId: string, phone: string | null): Promise<void> {
    // Même clé que CustomersService.create() / importCustomers() (E3) : sérialise
    // l'anonymisation contre une (re)création concurrente sur le même téléphone.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${organizationId}:${phone ?? ""}`}))`;
  }

  private async applyAnonymization(
    tx: TxClient,
    customer: { id: string; anonymizedAt: Date | null; invoices: RetentionInvoiceRow[] },
  ): Promise<AnonymizationApplied> {
    if (customer.anonymizedAt) {
      // No-op idempotent. `completed` reflète « la personne est anonymisée »,
      // pas l'issue exacte du 1ᵉʳ passage (voir la ligne de registre d'origine).
      return {
        outcome: "completed",
        note: `déjà anonymisé le ${customer.anonymizedAt.toISOString()} — rejeu no-op`,
        retentionExpiry: null,
      };
    }

    const now = new Date();
    const hasRetainedInvoices = customer.invoices.some(isRetainedInvoice);

    if (!hasRetainedInvoices) {
      // Anonymisation COMPLÈTE — aucune obligation de conservation.
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          name: CUSTOMER_NAME_TOMBSTONE,
          phone: null,
          nif: null,
          creditLimit: null,
          possibleDuplicateOf: null,
          notificationChannel: "sms",
          anonymizedAt: now,
        },
      });
      return { outcome: "completed", note: null, retentionExpiry: null };
    }

    // Anonymisation PARTIELLE — name + nif portés par des factures légales
    // (OHADA Art. 23), conservés ; tout le reste effacé.
    const retentionExpiry = retentionExpiryOf(customer.invoices);
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        phone: null,
        creditLimit: null,
        possibleDuplicateOf: null,
        notificationChannel: "sms",
        anonymizedAt: now,
      },
    });
    return {
      outcome: "partial",
      note: retentionExpiry
        ? `name/nif conservés jusqu'à ${retentionExpiry.toISOString()}`
        : "name/nif conservés — échéance de conservation indéterminée (facture sans date d'émission), à traiter manuellement",
      retentionExpiry,
    };
  }
}
