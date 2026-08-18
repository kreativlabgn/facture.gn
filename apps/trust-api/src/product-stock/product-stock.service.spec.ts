import { describe, expect, it, vi } from "vitest";
import { ProductStockService } from "./product-stock.service";

function createFakePrisma(overrides: { product?: any; existingStock?: any; stocks?: any[] } = {}) {
  return {
    product: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        overrides.product ?? { id: "product-1", organizationId: "org-1", name: "Riz 25kg" },
      ),
    },
    branch: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "branch-1", organizationId: "org-1" }),
    },
    productStock: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingStock ?? null),
      upsert: vi.fn().mockImplementation(({ create, update }: any) =>
        Promise.resolve({ id: "stock-1", productId: "product-1", branchId: "branch-1", stockQty: create?.stockQty ?? update?.stockQty?.increment }),
      ),
      findMany: vi.fn().mockResolvedValue(overrides.stocks ?? []),
    },
  };
}

describe("ProductStockService.recordMovement (E10, ADR-037)", () => {
  it("crée la ligne ProductStock au premier mouvement (reception) — stockQty = delta", async () => {
    const prisma = createFakePrisma();
    const service = new ProductStockService(prisma as any);

    await service.recordMovement("branch-1", "product-1", "reception", 50);

    expect(prisma.productStock.upsert).toHaveBeenCalledWith({
      where: { productId_branchId: { productId: "product-1", branchId: "branch-1" } },
      create: { productId: "product-1", branchId: "branch-1", stockQty: 50 },
      update: { stockQty: { increment: 50 } },
    });
  });

  it("incrémente stockQty existant sur une nouvelle réception", async () => {
    const prisma = createFakePrisma({ existingStock: { id: "stock-1", stockQty: 100 } });
    const service = new ProductStockService(prisma as any);

    await service.recordMovement("branch-1", "product-1", "reception", 20);

    expect(prisma.productStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { stockQty: { increment: 20 } } }),
    );
  });

  it("rejette reception avec un delta négatif ou nul (incohérence de signe)", async () => {
    const prisma = createFakePrisma();
    const service = new ProductStockService(prisma as any);

    await expect(service.recordMovement("branch-1", "product-1", "reception", -5)).rejects.toThrow(/reception/i);
    expect(prisma.productStock.upsert).not.toHaveBeenCalled();
  });

  it("rejette loss avec un delta positif ou nul (incohérence de signe)", async () => {
    const prisma = createFakePrisma();
    const service = new ProductStockService(prisma as any);

    await expect(service.recordMovement("branch-1", "product-1", "loss", 5)).rejects.toThrow(/loss/i);
    expect(prisma.productStock.upsert).not.toHaveBeenCalled();
  });

  it("accepte adjustment avec un delta positif ou négatif, sans validation de signe", async () => {
    const prisma = createFakePrisma();
    const service = new ProductStockService(prisma as any);

    await service.recordMovement("branch-1", "product-1", "adjustment", -3);

    expect(prisma.productStock.upsert).toHaveBeenCalled();
  });

  it("n'applique jamais de plancher à zéro — une perte peut amener stockQty sous zéro", async () => {
    const prisma = createFakePrisma({ existingStock: { id: "stock-1", stockQty: 2 } });
    const service = new ProductStockService(prisma as any);

    await service.recordMovement("branch-1", "product-1", "loss", -10);

    expect(prisma.productStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { stockQty: { increment: -10 } } }),
    );
  });

  it("rejette (NotFoundException) un produit n'appartenant PAS à l'organisation de la succursale — IDOR", async () => {
    const prisma = createFakePrisma({ product: { id: "product-1", organizationId: "org-victime", name: "X" } });
    const service = new ProductStockService(prisma as any);

    await expect(service.recordMovement("branch-1", "product-1", "reception", 10)).rejects.toThrow(/introuvable/);
    expect(prisma.productStock.upsert).not.toHaveBeenCalled();
  });
});

describe("ProductStockService.listByBranch (E10, ADR-084)", () => {
  it("ne retourne jamais costPrice, même si présent en base", async () => {
    const prisma = createFakePrisma({
      stocks: [
        {
          id: "stock-1",
          stockQty: 42,
          product: { id: "product-1", name: "Riz 25kg", costPrice: 15_000n },
        },
      ],
    });
    const service = new ProductStockService(prisma as any);

    const result = await service.listByBranch("branch-1");

    expect(result[0]).not.toHaveProperty("costPrice");
    expect(result[0]).toEqual({ productId: "product-1", productName: "Riz 25kg", stockQty: 42 });
  });
});
