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
