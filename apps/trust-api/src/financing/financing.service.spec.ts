import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FinancingService } from "./financing.service";

function baseInvoice(overrides: Record<string, any> = {}) {
  return {
    id: "inv-1",
    totalTtc: 5_000_000n,
    validatedByAdministration: true,
    financedByPartnerId: null,
    status: "issued",
    ...overrides,
  };
}

function createFakePrisma(
  overrides: {
    invoice?: any;
    partners?: any[];
    partner?: any;
    updateManyCount?: number;
  } = {},
) {
  const tx = {
    invoice: {
      updateMany: vi.fn().mockResolvedValue({ count: overrides.updateManyCount ?? 1 }),
    },
    invoiceEvent: {
      create: vi.fn().mockResolvedValue({ id: "event-1" }),
    },
  };
  return {
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.invoice ?? baseInvoice()),
    },
    financialPartner: {
      findMany: vi.fn().mockResolvedValue(overrides.partners ?? []),
      findUnique: vi.fn().mockResolvedValue(
        "partner" in overrides ? overrides.partner : { id: "partner-1", status: "active" },
      ),
    },
    $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe("FinancingService.getFinancingOptions (K4, ADR-031/088)", () => {
  it("liste les partenaires actifs quand la facture est finançable", async () => {
    const prisma = createFakePrisma({ partners: [{ id: "partner-1", name: "Ecobank", status: "active" }] });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1");

    expect(result.financeable).toBe(true);
    expect(result.partners).toHaveLength(1);
  });

  it("ne liste aucun partenaire quand la facture n'est pas finançable", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ validatedByAdministration: false }) });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1");

    expect(result.financeable).toBe(false);
    expect(result.partners).toEqual([]);
    expect(prisma.financialPartner.findMany).not.toHaveBeenCalled();
  });
});

describe("FinancingService.chooseFinancing (K4/K5, ADR-088/089)", () => {
  it("pose financedByPartnerId/financedAt et émet financing_disbursed sur une facture finançable", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing(
      "inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1",
    );

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv-1", financedByPartnerId: null }),
        data: { financedByPartnerId: "partner-1", financedAt: expect.any(Date) },
      }),
    );
    expect(prisma.__tx.invoiceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: "inv-1",
        type: "financing_disbursed",
        actorId: "user-1",
        amount: 5_000_000n,
      }),
    });
  });

  it("rejette (ConflictException) une facture non validée par l'administration", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ validatedByAdministration: false }) });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) une facture déjà financée (K5, anti-double financement)", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ financedByPartnerId: "autre-partner" }) });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(/déjà financée|non finançable/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette un financialPartnerId inconnu", async () => {
    const prisma = createFakePrisma({ partner: null });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-inconnu", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette un partenaire suspended", async () => {
    const prisma = createFakePrisma({ partner: { id: "partner-1", status: "suspended" } });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("la clause where transactionnelle revérifie status et validatedByAdministration, pas seulement financedByPartnerId (protège contre un void() concurrent)", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing(
      "inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1",
    );

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: "inv-1",
        financedByPartnerId: null,
        validatedByAdministration: true,
        status: { not: "voided" },
      },
      data: { financedByPartnerId: "partner-1", financedAt: expect.any(Date) },
    });
  });

  it("refuse une double demande concurrente — la seconde requête échoue proprement (K5)", async () => {
    const prisma = createFakePrisma({ updateManyCount: 0 });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.__tx.invoiceEvent.create).not.toHaveBeenCalled();
  });
});
