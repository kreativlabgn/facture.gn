import { describe, expect, it, vi } from "vitest";
import { UssdInvoiceListService } from "./ussd-invoice-list.service";

const ORG_ID = "org-1";

function createFakePrisma(invoices: any[] = []) {
  return { invoice: { findMany: vi.fn().mockResolvedValue(invoices) } };
}

describe("UssdInvoiceListService — mes factures (§2.3 Spec USSD)", () => {
  it("filtre sur documentType invoice et les statuts affichables, limite à 5, plus récentes d'abord", async () => {
    const prisma = createFakePrisma([{ id: "inv-1" }]);
    const service = new UssdInvoiceListService(prisma as any);

    await service.listRecent(ORG_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        documentType: "invoice",
        status: { in: ["issued", "partially_paid", "paid", "voided"] },
      },
      orderBy: { issuedAt: "desc" },
      take: 5,
    });
  });

  it("retourne la liste telle que renvoyée par Prisma", async () => {
    const invoices = [{ id: "inv-1" }, { id: "inv-2" }];
    const prisma = createFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    await expect(service.listRecent(ORG_ID)).resolves.toEqual(invoices);
  });
});

// K3, §2.6.2 Spec USSD — Option 6.2 "Statut de validation" : EXPOSE le champ
// validatedByAdministration déjà positionné par
// PublicBuyerPortalService.validateLiquidation() (J1, ADR-080/081/098), ne
// reconstruit aucune logique de validation. Jamais de donnée Trésor (Niveau 3,
// ADR-086) — hors scope, non construit.
describe("UssdInvoiceListService — statut de validation commande publique (K3, §2.6.2 Spec USSD)", () => {
  it("filtre sur documentType invoice, client entité publique, exclut les brouillons, limite à 5, plus récentes d'abord", async () => {
    const prisma = createFakePrisma([{ id: "inv-1" }]);
    const service = new UssdInvoiceListService(prisma as any);

    await service.listPublicOrderStatus(ORG_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        documentType: "invoice",
        customer: { isPublicEntity: true },
        status: { not: "draft" },
      },
      orderBy: { issuedAt: "desc" },
      take: 5,
    });
  });

  it("retourne la liste telle que renvoyée par Prisma, y compris validatedByAdministration", async () => {
    const invoices = [
      { id: "inv-1", number: "FG-2026-000010", validatedByAdministration: true },
      { id: "inv-2", number: "FG-2026-000011", validatedByAdministration: false },
    ];
    const prisma = createFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    await expect(service.listPublicOrderStatus(ORG_ID)).resolves.toEqual(invoices);
  });
});
