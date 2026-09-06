import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

const DISPLAYABLE_STATUSES = ["issued", "partially_paid", "paid", "voided"] as const;
// Exportée (revue post-fix #5) pour être réutilisée telle quelle par
// UssdInvoiceService.listPublicEntityCustomers — jamais une seconde
// constante `5` en dur qui pourrait diverger de celle-ci.
export const MAX_RESULTS = 5; // canal texte contraint (§6 Spec USSD)

// §2.3 Spec USSD — jamais draft/proforma/quote, jamais InvoicesService.findAllByOrganization
// (partagée avec le dashboard PWA, où proformas/devis doivent au contraire
// apparaître — y ajouter ce filtre y introduirait une régression).
@Injectable()
export class UssdInvoiceListService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async listRecent(organizationId: string) {
    // `where.organizationId` conservé : les politiques dorment encore et le
    // rôle applicatif possède les tables, donc contourne RLS.
    return organizationScopedClient(this.prisma, organizationId).invoice.findMany({
      where: { organizationId, documentType: "invoice", status: { in: [...DISPLAYABLE_STATUSES] } },
      orderBy: { issuedAt: "desc" },
      take: MAX_RESULTS,
    });
  }

  // K3, §2.6.2 Spec USSD — Option 6.2 "Statut de validation" : EXPOSE le champ
  // validatedByAdministration déjà positionné par
  // PublicBuyerPortalService.validateLiquidation() (J1, ADR-080/081/098), ne
  // reconstruit aucune logique de validation. Scopé par organizationId
  // (émetteur PME), jamais par PublicBuyerAccountMember — ce scope
  // d'autorisation reste celui du DAF (public-buyer-portal), pas de la PME
  // émettrice. draft exclu : jamais "en cours de validation" tant que la PME
  // ne l'a pas émise. Aucune donnée Trésor (Niveau 3, ADR-086) — hors scope.
  async listPublicOrderStatus(organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).invoice.findMany({
      where: {
        organizationId,
        documentType: "invoice",
        customer: { isPublicEntity: true },
        status: { not: "draft" },
      },
      orderBy: { issuedAt: "desc" },
      take: MAX_RESULTS,
    });
  }
}
