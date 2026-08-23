import { describe, expect, it, vi } from "vitest";
import { MarginService } from "./margin.service";

function createFakePrisma(lines: any[]) {
  return {
    invoiceLine: {
      findMany: vi.fn().mockResolvedValue(lines),
    },
  };
}

const SALE_LINE = {
  quantity: 2,
  unitPrice: 25_000n,
  costPriceAtTime: 15_000n,
  invoice: { id: "inv-1", issuedAt: new Date("2026-08-19T00:00:00.000Z") },
  product: { id: "product-1", name: "Sac de riz 50kg" },
};

describe("MarginService.listLines (E7, ADR-084)", () => {
  it("ne considère que les factures issued/partially_paid/paid — même filtre que FecService", async () => {
    const prisma = createFakePrisma([SALE_LINE]);
    const service = new MarginService(prisma as any);

    await service.listLines("org-1");

    expect(prisma.invoiceLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoice: expect.objectContaining({
            organizationId: "org-1",
            status: { in: ["issued", "partially_paid", "paid"] },
          }),
          productId: { not: null },
        }),
      }),
    );
  });

  it("calcule marginGnf = (unitPrice - costPriceAtTime) * quantity", async () => {
    const prisma = createFakePrisma([SALE_LINE]);
    const service = new MarginService(prisma as any);

    const result = await service.listLines("org-1");

    expect(result[0].marginGnf).toBe(20_000n); // (25_000 - 15_000) * 2
    expect(result[0].productName).toBe("Sac de riz 50kg");
    expect(result[0].invoiceId).toBe("inv-1");
  });

  it("ne fabrique jamais marginGnf=0 quand costPriceAtTime est null — marge non calculable, pas nulle", async () => {
    const prisma = createFakePrisma([{ ...SALE_LINE, costPriceAtTime: null }]);
    const service = new MarginService(prisma as any);

    const result = await service.listLines("org-1");

    expect(result[0].marginGnf).toBeNull();
    expect(result[0].marginPct).toBeNull();
  });

  it("pagine avec DEFAULT_LIST_PAGE_SIZE=50 par défaut (Quality Audit 2026-08-23, finding #6)", async () => {
    const prisma = createFakePrisma([SALE_LINE]);
    const service = new MarginService(prisma as any);

    await service.listLines("org-1");

    expect(prisma.invoiceLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 }),
    );
  });

  it("plafonne take à MAX_LIST_PAGE_SIZE=100, jamais une réponse non bornée", async () => {
    const prisma = createFakePrisma([SALE_LINE]);
    const service = new MarginService(prisma as any);

    await service.listLines("org-1", { take: 10_000, skip: 20 });

    expect(prisma.invoiceLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, skip: 20 }),
    );
  });

  it("un skip au-delà du nombre total de lignes retourne [] proprement, jamais une erreur (Quality Audit 2026-08-23, revue post-fix #6, cas limite)", async () => {
    // Prisma renvoie [] pour un skip hors bornes (comportement standard SQL
    // OFFSET) — ce test vérifie que MarginService ne fait aucune hypothèse sur
    // un résultat non-vide (pas d'accès direct à result[0] ni de division par
    // un total supposé positif) et propage simplement le tableau vide.
    const prisma = createFakePrisma([]);
    const service = new MarginService(prisma as any);

    const result = await service.listLines("org-1", { take: 50, skip: 1000 });

    expect(result).toEqual([]);
  });
});

describe("MarginService.listByProduct (E7, ADR-084)", () => {
  it("agrège plusieurs lignes du même produit sur plusieurs factures", async () => {
    const prisma = createFakePrisma([
      SALE_LINE,
      { ...SALE_LINE, invoice: { id: "inv-2", issuedAt: new Date("2026-08-19T00:00:00.000Z") } },
    ]);
    const service = new MarginService(prisma as any);

    const result = await service.listByProduct("org-1");

    expect(result).toEqual([
      {
        productId: "product-1",
        productName: "Sac de riz 50kg",
        totalMarginGnf: 40_000n,
        lineCount: 2,
        linesWithoutCostCount: 0,
      },
    ]);
  });

  it("compte séparément les lignes sans coût — jamais mélangées avec une marge à 0", async () => {
    const prisma = createFakePrisma([SALE_LINE, { ...SALE_LINE, costPriceAtTime: null }]);
    const service = new MarginService(prisma as any);

    const result = await service.listByProduct("org-1");

    expect(result[0].totalMarginGnf).toBe(20_000n);
    expect(result[0].lineCount).toBe(2);
    expect(result[0].linesWithoutCostCount).toBe(1);
  });
});
