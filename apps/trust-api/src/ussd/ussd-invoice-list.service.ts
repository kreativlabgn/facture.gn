import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

const DISPLAYABLE_STATUSES = ["issued", "partially_paid", "paid", "voided"] as const;
const MAX_RESULTS = 5; // canal texte contraint (§6 Spec USSD)

// §2.3 Spec USSD — jamais draft/proforma/quote, jamais InvoicesService.findAllByOrganization
// (partagée avec le dashboard PWA, où proformas/devis doivent au contraire
// apparaître — y ajouter ce filtre y introduirait une régression).
@Injectable()
export class UssdInvoiceListService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async listRecent(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId, documentType: "invoice", status: { in: [...DISPLAYABLE_STATUSES] } },
      orderBy: { issuedAt: "desc" },
      take: MAX_RESULTS,
    });
  }
}
