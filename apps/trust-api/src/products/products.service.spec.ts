import { describe, expect, it, vi } from "vitest";
import { ProductsService } from "./products.service";

function createFakePrisma() {
  return {
    product: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "product-1", ...data })),
    },
  };
}

describe("ProductsService.create (E10)", () => {
  it("crée un produit avec le nom fourni", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    const result = await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg" },
    });
    expect(result.id).toBe("product-1");
  });

  it("ne fabrique jamais un costPrice par défaut — territoire d'E6, hors scope ici", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    const createCall = prisma.product.create.mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty("costPrice");
  });
});
