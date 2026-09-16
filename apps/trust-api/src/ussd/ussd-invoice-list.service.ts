import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

const DISPLAYABLE_STATUSES = ["issued", "partially_paid", "paid", "voided"] as const;
// Exportée (revue post-fix #5) pour être réutilisée telle quelle par
// UssdInvoiceService.listPublicEntityCustomers — jamais une seconde
// constante `5` en dur qui pourrait diverger de celle-ci.
export const MAX_RESULTS = 5; // canal texte contraint (§6 Spec USSD)

// Capacité 2, C3 (plan 2026-09-16-ussd-flash-recherche-encaissement-cash.md) —
// masquage RGPD du téléphone client dans l'historique MARCHAND (listRecent()) :
// le marchand voit "à qui" au format tronqué, jamais le numéro complet en
// clair sur ce canal. 3 premiers + 3 derniers chiffres de la PARTIE LOCALE
// (préfixe +224 retiré avant masquage, pour matcher le format PM
// "620***233"), reste en "*". Une partie locale trop courte pour distinguer
// un préfixe et un suffixe sans chevauchement (≤ 6 chiffres) est masquée en
// entier plutôt que de risquer une fuite partielle incohérente.
export function maskPhoneRgpd(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const local = phone.startsWith("+224") ? phone.slice(4) : phone;
  if (local.length <= 6) {
    return "*".repeat(local.length);
  }
  const prefix = local.slice(0, 3);
  const suffix = local.slice(-3);
  const middle = "*".repeat(local.length - 6);
  return `${prefix}${middle}${suffix}`;
}

// §2.3 Spec USSD — jamais draft/proforma/quote, jamais InvoicesService.findAllByOrganization
// (partagée avec le dashboard PWA, où proformas/devis doivent au contraire
// apparaître — y ajouter ce filtre y introduirait une régression).
@Injectable()
export class UssdInvoiceListService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async listRecent(organizationId: string) {
    // `where.organizationId` conservé : les politiques dorment encore et le
    // rôle applicatif possède les tables, donc contourne RLS.
    const invoices = await organizationScopedClient(this.prisma, organizationId).invoice.findMany({
      where: { organizationId, documentType: "invoice", status: { in: [...DISPLAYABLE_STATUSES] } },
      orderBy: { issuedAt: "desc" },
      take: MAX_RESULTS,
      include: { customer: { select: { phone: true } } },
    });

    // Destructuration (jamais un spread du `customer` brut) : le champ
    // customer.phone en clair ne doit JAMAIS ressortir de cette méthode,
    // capacité 2 du plan — voir maskPhoneRgpd ci-dessus.
    return invoices.map(({ customer, ...invoice }) => ({
      ...invoice,
      customerPhoneMasked: maskPhoneRgpd(customer?.phone ?? null),
    }));
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
