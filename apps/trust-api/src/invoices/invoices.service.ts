import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { CERTIFICATION_SERVICE } from "../certification/certification.module";
import { resolveNifForCertification } from "../certification/certification.service";
import type { CertificationService } from "../certification/certification.service";
import { PaymentLinkClient } from "../money-client/payment-link-client";
import { InvoiceNumberingService } from "./invoice-numbering.service";
import { computeTaxBreakdown, resolveTaxRateBps } from "./tax-regime";
import type { CreateInvoiceDto } from "./dto/create-invoice.dto";

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly numbering: InvoiceNumberingService,
    @Inject(CERTIFICATION_SERVICE) private readonly certification: CertificationService,
    private readonly paymentLinkClient: PaymentLinkClient,
  ) {}

  async createDraft(dto: CreateInvoiceDto) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: dto.organizationId },
    });
    const taxRateBps = resolveTaxRateBps(organization.regimeFiscal);

    const totalTtcBrut = dto.lines.reduce((sum, line) => sum + BigInt(line.quantity) * line.unitPrice, 0n);
    // Remise globale (E2) appliquée AVANT le calcul HT/TVA — convention TTC-first
    // (C4) : la remise réduit le montant TTC brut, la ventilation HT/TVA est
    // ensuite dérivée du montant déjà net, jamais recalculée indépendamment.
    const discountPct = dto.discountPct ?? 0;
    const totalTtc = totalTtcBrut - (totalTtcBrut * BigInt(discountPct)) / 100n;
    const { totalHt, totalTva } = computeTaxBreakdown(totalTtc, taxRateBps);

    return this.prisma.invoice.create({
      data: {
        organizationId: dto.organizationId,
        documentType: dto.documentType,
        status: "draft",
        totalTtc,
        totalHt,
        totalTva,
        discountPct,
        amountDue: totalTtc,
        // Référence devise étrangère (I3, ADR-055) — purement informatif, jamais
        // recalculé ni vérifié côté serveur. undefined si non fourni (les 4 champs
        // ensemble ou aucun, garanti par le refine du DTO).
        referenceCurrency: dto.referenceCurrency,
        referenceAmount: dto.referenceAmount,
        fxRate: dto.fxRate,
        fxRateDate: dto.fxRateDate,
        lines: {
          create: dto.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRateBps,
          })),
        },
      },
    });
  }

  // Une facture issued est immuable — toute correction passe par un avoir (DAT §5.4).
  async updateDraft(invoiceId: string, patch: Prisma.InvoiceUpdateInput) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== "draft") {
      throw new ConflictException(
        "Une facture issued est immuable — toute correction passe par un avoir (credit_note)",
      );
    }
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: patch });
  }

  async issue(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== "draft") {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut être émise depuis le statut ${invoice.status}`,
      );
    }
    // ADR-064 : un proforma (prix indicatif, jamais engageant) ou un devis ne peuvent
    // jamais être émis directement comme facture certifiée — seule la conversion
    // (convertToInvoice) produit une vraie facture à partir d'un proforma.
    if (invoice.documentType !== "invoice") {
      throw new ConflictException(
        `Seule une facture peut être émise, pas un document de type ${invoice.documentType}`,
      );
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: invoice.organizationId },
    });

    const issuedAt = new Date();
    const number = await this.numbering.nextNumber(invoice.organizationId, issuedAt.getFullYear());

    const previousInvoice = await this.prisma.invoice.findFirst({
      where: { organizationId: invoice.organizationId, status: { not: "draft" } },
      orderBy: { issuedAt: "desc" },
    });

    const certification = this.certification.certify({
      invoiceId: invoice.id,
      organizationNif: resolveNifForCertification(organization.nif),
      number,
      totalTtc: invoice.totalTtc,
      issuedAt: issuedAt.toISOString(),
      previousHash: previousInvoice?.hash ?? "GENESIS",
    });

    let issuedInvoice;
    try {
      issuedInvoice = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          number,
          certificationId: certification.certificationId,
          hash: certification.hash,
          previousHash: certification.previousHash,
          signature: Buffer.from(certification.signature, "hex"),
          status: "issued",
          issuedAt,
          amountDue: invoice.totalTtc,
        },
      });
    } catch (error) {
      // Filet de sécurité : InvoiceNumberingService (upsert atomique par organisation/
      // année) ne devrait jamais produire ce conflit, mais un 409 explicite vaut mieux
      // qu'un 500 brut si la séquence dérivait un jour sous concurrence extrême.
      if (isUniqueConstraintViolation(error, "number")) {
        throw new ConflictException(
          `Le numéro ${number} existe déjà pour cette organisation — réémission impossible`,
        );
      }
      // Filet de sécurité : certification_id est unique globalement (GN-{NIF8}-{YYYY}-
      // {HASH6}). Les organisations sans NIF (B1/B4) partagent toutes le même segment
      // NIF8 (UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER), ce qui réduit l'espace de
      // collision de HASH6 à l'échelle de toute la plateforme pour une année donnée —
      // un 409 explicite vaut mieux qu'un 500 brut si deux hash coïncident.
      if (isUniqueConstraintViolation(error, "certification_id")) {
        throw new ConflictException(
          "Collision d'identifiant de certification — réémission impossible, réessayer",
        );
      }
      throw error;
    }

    // Meilleur effort, jamais couplé à la certification (déjà committée ci-dessus) :
    // DAT §12 fixe deux SLA distinctes ("Émission facture < 2s" / "Génération lien
    // de paiement < 3s") — une panne Money Context ne doit jamais faire échouer
    // l'émission (Parcours Fanta : cash et lien ne s'excluent jamais l'un l'autre ;
    // C18 permet de régénérer un lien absent plus tard).
    const paymentLink = await this.paymentLinkClient.tryGenerate({
      invoiceId: issuedInvoice.id,
      organizationId: issuedInvoice.organizationId,
      amountGnf: issuedInvoice.totalTtc,
    });
    if (!paymentLink) {
      return issuedInvoice;
    }

    // Même garantie que l'appel HTTP lui-même : un corps de réponse money-api
    // inattendu (ex. paymentLinkExpiresAt invalide) ne doit jamais faire échouer
    // une émission déjà certifiée et committée.
    try {
      return await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          paymentLinkUrl: paymentLink.paymentLinkUrl,
          paymentLinkId: paymentLink.providerRef,
          paymentLinkExpiresAt: paymentLink.expiresAt,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Facture ${invoiceId} certifiée mais l'enregistrement du lien de paiement a échoué : ${(error as Error).message}`,
      );
      return issuedInvoice;
    }
  }

  // ADR-064 : la conversion crée toujours une NOUVELLE facture — jamais une mutation
  // en place du proforma — et recalcule le régime fiscal depuis l'organisation
  // ACTUELLE, jamais depuis les lignes déjà stockées sur le proforma (même si
  // regimeFiscal n'est modifiable nulle part aujourd'hui, cette règle protège contre
  // une dérive silencieuse le jour où un mécanisme de changement existera).
  async convertToInvoice(proformaId: string) {
    const proforma = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: proformaId },
      include: { lines: true },
    });

    // C16, ADR-064 : proforma ET devis se convertissent par le même mécanisme —
    // aucune différence de traitement à la conversion elle-même, la distinction
    // (arrhes autorisées vs aucun paiement) est portée en amont par les gardes
    // indépendantes de forfeitDeposit()/recordDepositPayment() (restées proforma-only).
    if (proforma.documentType !== "proforma" && proforma.documentType !== "quote") {
      throw new ConflictException(
        `Seul un document de type proforma ou devis peut être converti en facture (actuel : ${proforma.documentType})`,
      );
    }
    if (proforma.status !== "draft") {
      throw new ConflictException(
        `Proforma ${proformaId} ne peut être converti depuis le statut ${proforma.status}`,
      );
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: proforma.organizationId },
    });
    const taxRateBps = resolveTaxRateBps(organization.regimeFiscal);
    const { totalHt, totalTva } = computeTaxBreakdown(proforma.totalTtc, taxRateBps);

    return this.prisma.$transaction(async (tx) => {
      // Réclame le proforma atomiquement AVANT de créer la facture : sous deux
      // conversions concurrentes (retry réseau plausible sur ce projet — PWA
      // offline-first, réseau mobile instable), seule la transaction qui voit encore
      // status="draft" au moment de l'écriture peut committer — l'autre reçoit
      // count=0 et échoue proprement, jamais deux factures pour un même proforma.
      const claimed = await tx.invoice.updateMany({
        where: { id: proformaId, status: "draft" },
        data: { status: "converted" },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          `Proforma ${proformaId} a déjà été converti par une autre requête`,
        );
      }

      const invoice = await tx.invoice.create({
        data: {
          organizationId: proforma.organizationId,
          documentType: "invoice",
          status: "draft",
          totalTtc: proforma.totalTtc,
          totalHt,
          totalTva,
          // proforma.totalTtc est déjà net de remise (E2) — copier discountPct est
          // purement informatif (traçabilité de la remise appliquée), aucun recalcul.
          discountPct: proforma.discountPct,
          amountDue: proforma.totalTtc,
          // Référence devise (I3) délibérément PAS copiée, contrairement à
          // discountPct : un taux de change peut être devenu obsolète entre la
          // création du proforma/devis et sa conversion — jamais reconduit tel quel,
          // l'organisation doit le ressaisir si toujours pertinent.
          lines: {
            create: proforma.lines.map((line: { description: string; quantity: number; unitPrice: bigint }) => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRateBps,
            })),
          },
        },
      });

      await tx.invoice.update({
        where: { id: proformaId },
        data: { convertedToInvoiceId: invoice.id },
      });

      return invoice;
    });
  }

  // ADR-034 : forfait d'arrhes (no-show ou dédit exercé) — reason est fourni par le
  // staff (Djénabou), jamais détecté automatiquement (aucun scheduler, aucune date de
  // réservation stockée dans ce schéma). L'arrhes (Payment) n'est jamais effacée ;
  // l'InvoiceEvent est la trace d'audit permanente de ce qui lui est arrivé
  // (ADR-015, "source de vérité audit") — jamais recalculé, jamais mutable.
  async forfeitDeposit(
    proformaId: string,
    reason: "cancellation_indemnity" | "no_show_forfeited",
    actorId: string,
  ) {
    const proforma = await this.prisma.invoice.findUniqueOrThrow({ where: { id: proformaId } });

    if (proforma.documentType !== "proforma") {
      throw new ConflictException(
        `Seul un proforma peut avoir une arrhes forfaitée (actuel : ${proforma.documentType})`,
      );
    }
    // Message dédié (distinct de la garde anti-course ci-dessous) : un proforma déjà
    // converted/voided n'est pas une course concurrente, c'est un état métier légitime
    // (ex. le client s'est présenté, la réservation a été honorée) — Djénabou doit
    // comprendre la vraie raison, pas un message générique de conflit.
    if (proforma.status !== "draft") {
      throw new ConflictException(
        `Proforma ${proformaId} ne peut avoir son arrhes forfaitée depuis le statut ${proforma.status}`,
      );
    }

    const deposit = await this.prisma.payment.findFirst({
      where: { invoiceId: proformaId, depositType: "arrhes" },
    });
    if (!deposit) {
      throw new ConflictException(`Proforma ${proformaId} n'a aucune arrhes enregistrée à forfaiter`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Même garde atomique que convertToInvoice() (C15) : sous deux forfaits
      // concurrents, seule la transaction qui voit encore status="draft" au moment
      // de l'écriture peut committer — la vérification ci-dessus a déjà éliminé le
      // cas "état métier déjà différent", ce filet ne couvre plus que la vraie course.
      const claimed = await tx.invoice.updateMany({
        where: { id: proformaId, status: "draft" },
        data: { status: "voided" },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Proforma ${proformaId} a déjà été clôturé par une autre requête`);
      }

      return tx.invoiceEvent.create({
        data: { invoiceId: proformaId, type: reason, amount: deposit.amount, actorId },
      });
    });
  }

  // ADR-066 : "Régénérable à la demande" — divergence assumée vs. issue(), où la
  // génération de lien est un effet secondaire meilleur-effort d'une action plus
  // importante déjà committée. Ici la régénération EST l'action demandée : un échec
  // de tryGenerate() doit être visible (ConflictException), jamais un succès
  // silencieux sans nouveau lien. Le tag "dormant" (2e mécanisme d'ADR-066, factures
  // >90j sans action) est hors scope : nécessiterait une tâche planifiée périodique,
  // absente de ce repo.
  async regeneratePaymentLink(invoiceId: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    if (invoice.status !== "issued" && invoice.status !== "partially_paid") {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut recevoir un nouveau lien de paiement depuis le statut ${invoice.status}`,
      );
    }

    // Aucune garde sur paymentLinkExpiresAt : ADR-066 dit "régénérable à la demande",
    // pas "uniquement si expiré" — un marchand peut vouloir un nouveau lien même non
    // expiré (perdu, jamais transmis au client). Choix délibéré, pas un oubli.
    // amountDue (jamais totalTtc, C11) : sur une facture partially_paid, le lien doit
    // refléter le solde RESTANT — utiliser totalTtc redemanderait au client un
    // montant déjà partiellement réglé (bug corrigé, C11).
    const paymentLink = await this.paymentLinkClient.tryGenerate({
      invoiceId: invoice.id,
      organizationId: invoice.organizationId,
      amountGnf: invoice.amountDue,
    });
    if (!paymentLink) {
      throw new ConflictException("Impossible de générer un nouveau lien de paiement pour le moment");
    }

    // Transaction requise (revue de code) : contrairement à G1 où l'InvoiceEvent est
    // un signal secondaire best-effort, ici il est la SEULE preuve d'audit de qui a
    // déclenché la régénération — un lien mis à jour sans sa trace correspondante
    // serait un vrai trou d'audit, jamais un lien changé sans que ce soit tracé.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paymentLinkUrl: paymentLink.paymentLinkUrl,
          paymentLinkId: paymentLink.providerRef,
          paymentLinkExpiresAt: paymentLink.expiresAt,
        },
      });

      await tx.invoiceEvent.create({
        data: { invoiceId, type: "payment_link_regenerated", actorId },
      });

      return updated;
    });
  }

  // voided réservé aux factures sans aucun paiement (PRD §4.2).
  async void(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    if (invoice.amountPaid > 0n) {
      throw new ConflictException(
        "Une facture avec un paiement enregistré ne peut être annulée — utiliser un avoir",
      );
    }

    if (invoice.status !== "draft" && invoice.status !== "issued") {
      throw new ConflictException(`Facture ${invoiceId} ne peut être annulée depuis le statut ${invoice.status}`);
    }

    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: "voided" } });
  }
}
