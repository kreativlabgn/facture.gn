import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { MAX_RESULTS } from "./ussd-invoice-list.service";

const SEARCH_ELIGIBLE_STATUSES = ["issued", "partially_paid"] as const;

// *620#, capacité 2 (recherche composite téléphone + montant) — dédoublonnage
// même-jour : un couple téléphone+montant peut correspondre à plusieurs
// factures émises le même jour (ventes répétées), jamais à travers les jours
// (bornes UTC strictes, Guinée = UTC+0 à l'année, pas de TZ à gérer).
//
// Non-fuite cross-org, par construction : la requête part d'Invoice (pas de
// Customer), organizationId est posé au niveau racine du `where` — la clause
// imbriquée customer: { phone } ne fait que restreindre PARMI les factures
// déjà scopées à cette organisation, elle ne peut jamais l'élargir à une autre
// organisation, quel que soit le nombre d'organisations où ce même numéro est
// client ailleurs sur la plateforme (voir Customer.phone, index plateforme-wide,
// précédent ClientPortalService/F13 — ici le point de départ est Invoice, déjà
// scopé, contrairement à ce précédent qui part de Customer).
@Injectable()
export class UssdInvoiceSearchService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async searchByPhoneAndAmount(organizationId: string, phone: string, amountTtcCentimes: bigint) {
    const now = new Date();
    const startOfDayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const startOfNextDayUtc = new Date(startOfDayUtc.getTime() + 86_400_000);

    return organizationScopedClient(this.prisma, organizationId).invoice.findMany({
      where: {
        organizationId,
        documentType: "invoice",
        status: { in: [...SEARCH_ELIGIBLE_STATUSES] },
        totalTtc: amountTtcCentimes,
        issuedAt: { gte: startOfDayUtc, lt: startOfNextDayUtc },
        customer: { phone },
      },
      orderBy: { issuedAt: "desc" },
      take: MAX_RESULTS,
    });
  }
}
