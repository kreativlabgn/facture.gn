import { describe, expect, it, vi } from "vitest";
import { ProductsService } from "./products.service";

function createFakePrisma(overrides: { existingMatch?: any } = {}) {
  const prisma: any = {
    // Cross-Story Audit 2026-08-24, finding #3 — create() englobe désormais
    // findFirst+create dans une transaction : callback(prisma) réutilise
    // directement les mêmes mocks product.findFirst/create (tx === prisma ici).
    $transaction: vi.fn((callback: any) => callback(prisma)),
    product: {
      // findFirst simule fidèlement le filtrage Prisma réel sur organizationId : un
      // existingMatch configuré pour une AUTRE organisation que celle demandée dans le
      // `where` n'est jamais retourné — preuve du scoping organizationId (voir tests
      // dédiés "AUTRE organisation" ci-dessous). Rétrocompatible : un existingMatch sans
      // organizationId n'est jamais filtré (comportement des tests existants inchangé).
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const match = overrides.existingMatch;
        if (!match) return Promise.resolve(null);
        if (match.organizationId && match.organizationId !== where.organizationId) {
          return Promise.resolve(null);
        }
        return Promise.resolve(match);
      }),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "product-1", ...data })),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      delete: vi.fn(),
    },
  };
  return prisma;
}

describe("ProductsService.create (E10)", () => {
  it("crée un produit avec le nom fourni", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    const result = await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg", possibleDuplicateOf: null },
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

describe("ProductsService.create — dédoublonnage par nom (E3, ADR-038)", () => {
  it("pose possibleDuplicateOf quand un produit du même nom existe déjà dans l'organisation", async () => {
    const prisma = createFakePrisma({ existingMatch: { id: "product-existant", name: "Riz 25kg" } });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: { equals: "Riz 25kg", mode: "insensitive" } },
    });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg", possibleDuplicateOf: "product-existant" },
    });
    expect(result.possibleDuplicateOf).toBe("product-existant");
  });

  it("matche indépendamment de la casse — 'riz 25kg' détecte 'Riz 25kg'", async () => {
    const prisma = createFakePrisma({ existingMatch: { id: "product-existant", name: "Riz 25kg" } });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "riz 25kg" });

    // Preuve directe que CE test exerce bien mode: "insensitive" — sans cette assertion,
    // le test passerait même si le service comparait en sensible à la casse et que le
    // mock (qui ignore les arguments) retournait quand même existingMatch par accident.
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: { equals: "riz 25kg", mode: "insensitive" } },
    });
    expect(result.possibleDuplicateOf).toBe("product-existant");
  });

  it("laisse possibleDuplicateOf null quand aucun produit de l'organisation ne partage ce nom", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    expect(result.possibleDuplicateOf).toBeNull();
  });

  it("laisse possibleDuplicateOf null quand le seul produit du même nom appartient à une AUTRE organisation", async () => {
    const prisma = createFakePrisma({
      existingMatch: { id: "product-autre-org", organizationId: "org-2", name: "Riz 25kg" },
    });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg", possibleDuplicateOf: null },
    });
    expect(result.possibleDuplicateOf).toBeNull();
  });

  it("détecte comme doublon un nom ressaisi avec un espace de fin/début en trop", async () => {
    const prisma = createFakePrisma({ existingMatch: { id: "product-existant", name: "Riz 25kg" } });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "  Riz 25kg  " });

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: { equals: "Riz 25kg", mode: "insensitive" } },
    });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg", possibleDuplicateOf: "product-existant" },
    });
    expect(result.possibleDuplicateOf).toBe("product-existant");
  });

  it("ne modifie ni ne supprime jamais l'enregistrement existant trouvé (ADR-038)", async () => {
    const prisma = createFakePrisma({ existingMatch: { id: "product-existant", name: "Riz 25kg" } });
    const service = new ProductsService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Riz 25kg" });

    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  // Cross-Story Audit 2026-08-24, finding #3 MOYENNE-HAUTE — même test de
  // concurrence réelle et même limite honnêtement documentée que
  // CustomersService.create() (voir son commentaire jumeau dans
  // customers.service.spec.ts) : état partagé par closure (tableau réel, pas un
  // count forcé), Promise.all, la transaction réduit la fenêtre de course sans
  // l'éliminer sous isolation Read Committed (best-effort assumé, ADR-038).
  it("Cross-Story Audit 2026-08-24, finding #3 — sous deux create() réellement concurrents du même nom, la transaction réduit la fenêtre de course SANS l'éliminer (best-effort assumé, ADR-038)", async () => {
    const products: any[] = [];
    let createCallCount = 0;
    const prisma: any = {
      $transaction: vi.fn((callback: any) => callback(prisma)),
      product: {
        findFirst: vi.fn(async ({ where }: any) =>
          products.find(
            (p) => p.organizationId === where.organizationId && p.name.toLowerCase() === where.name.equals.toLowerCase(),
          ) ?? null,
        ),
        create: vi.fn(async ({ data }: any) => {
          createCallCount += 1;
          const row = { id: `product-race-${createCallCount}`, ...data };
          products.push(row);
          return row;
        }),
      },
    };
    const service = new ProductsService(prisma as any);

    const [resultA, resultB]: any[] = await Promise.all([
      service.create({ organizationId: "org-1", name: "Riz 25kg" }),
      service.create({ organizationId: "org-1", name: "Riz 25kg" }),
    ]);

    expect(products).toHaveLength(2);
    // Limite honnêtement documentée : sous cette course, ni l'une ni l'autre ne
    // voit le doublon de l'autre.
    expect(resultA.possibleDuplicateOf).toBeNull();
    expect(resultB.possibleDuplicateOf).toBeNull();
  });
});

describe("ProductsService.setCostPrice (E6, ADR-084)", () => {
  it("met à jour costPrice sur le produit ciblé", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    const result = await service.setCostPrice("product-1", 15_000n);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { costPrice: 15_000n },
    });
    expect(result.costPrice).toBe(15_000n);
  });
});
