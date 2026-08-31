import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import type { PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../common/prisma.module";
import {
  hashMsisdn,
  normalizeMsisdn,
  type SubjectDataExport,
  type SubjectCustomerRecord,
} from "./subject-data";

// J2, ADR-116 — droit d'accès (export) et droit à l'effacement (anonymisation).
// Le service fait ses propres requêtes Prisma (aucune dépendance vers
// CustomersModule). Toute opération écrit une ligne immuable dans
// `data_rights_request` (registre de responsabilité opposable au régulateur PDP).
//
// `organizationId` non nul = chemin PME (RolesGuard a déjà vérifié que l'appelant
// est owner/admin de cette organisation) → tout est scopé à cette organisation.
// `organizationId` nul = chemin ops plateforme (clé interne dédiée) → transverse.
@Injectable()
export class DataRightsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // normalizeMsisdn est pur (lève un Error nu) — le traduire en 400 propre.
  private toCanonical(phone: string): string {
    try {
      return normalizeMsisdn(phone);
    } catch {
      throw new BadRequestException("numéro de téléphone guinéen invalide");
    }
  }

  async exportSubjectData(params: {
    phone: string;
    organizationId: string | null;
    requestedByUserId?: string;
  }): Promise<SubjectDataExport> {
    const canonical = this.toCanonical(params.phone);
    const subjectPhoneHash = hashMsisdn(canonical);
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

    const userPhone = await this.prisma.userPhone.findFirst({
      where: { msisdn: canonical },
      include: { user: { include: { phones: { select: { msisdn: true } } } } },
    });
    const account = userPhone
      ? {
          userId: userPhone.user.id,
          name: userPhone.user.name,
          preferredLanguage: userPhone.user.preferredLanguage,
          phones: userPhone.user.phones.map((p) => p.msisdn),
        }
      : null;

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
}
