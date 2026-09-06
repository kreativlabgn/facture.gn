import { describe, expect, it, vi } from "vitest";

// organizationScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes inchangées.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}
import { ProductsService } from "./products.service";

function createFakePrisma(overrides: { existingMatch?: any } = {}) {
  const prisma: any = auClientScope({
    // Cross-Story Audit 2026-08-24, finding #3 — create() englobe désormais
    // findFirst+create dans une transaction : callback(prisma) réutilise
    // directement les mêmes mocks product.findFirst/create (tx === prisma ici).
    $transaction: vi.fn((callback: any) => callback(prisma)),
    // Cross-Story Audit 2026-08-24, finding #3 (verrou consultatif) —
    // pg_advisory_xact_lock posé via $executeRaw avant le findFirst, à chaque
    // create() (le nom est toujours présent, contrairement au téléphone
    // optionnel de CustomersService). Resolved par défaut ici — voir le test
    // de concurrence dédié plus bas pour un $executeRaw qui simule réellement le
    // verrou.
    $executeRaw: vi.fn().mockResolvedValue(1),
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
      // setCostPrice() lit le produit (scopé) avant de l'écrire : c'est la
      // barrière tant que les politiques RLS dorment.
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: "product-1", organizationId: "org-1", name: "Riz 25kg" }),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      delete: vi.fn(),
    },
  });
  return prisma;
}

describe("ProductsService.create (E10)", () => {
  it("crée un produit avec le nom fourni", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    const result = await service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1");

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg", possibleDuplicateOf: null },
    });
    expect(result.id).toBe("product-1");
  });

  it("ne fabrique jamais un costPrice par défaut — territoire d'E6, hors scope ici", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1");

    const createCall = prisma.product.create.mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty("costPrice");
  });
});

describe("ProductsService.create — dédoublonnage par nom (E3, ADR-038)", () => {
  it("pose possibleDuplicateOf quand un produit du même nom existe déjà dans l'organisation", async () => {
    const prisma = createFakePrisma({ existingMatch: { id: "product-existant", name: "Riz 25kg" } });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1");

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

    const result: any = await service.create({ organizationId: "org-1", name: "riz 25kg" }, "org-1");

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

    const result: any = await service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1");

    expect(result.possibleDuplicateOf).toBeNull();
  });

  it("laisse possibleDuplicateOf null quand le seul produit du même nom appartient à une AUTRE organisation", async () => {
    const prisma = createFakePrisma({
      existingMatch: { id: "product-autre-org", organizationId: "org-2", name: "Riz 25kg" },
    });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1");

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Riz 25kg", possibleDuplicateOf: null },
    });
    expect(result.possibleDuplicateOf).toBeNull();
  });

  it("détecte comme doublon un nom ressaisi avec un espace de fin/début en trop", async () => {
    const prisma = createFakePrisma({ existingMatch: { id: "product-existant", name: "Riz 25kg" } });
    const service = new ProductsService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "  Riz 25kg  " }, "org-1");

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

    await service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1");

    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  // Simule fidèlement pg_advisory_xact_lock(hashtext(clé)) — même mécanisme et
  // même helper jumeau que customers.service.spec.ts (voir son commentaire
  // détaillé) : une Map<clé, Promise> sérialise les appelants partageant la
  // MÊME clé, jamais deux clés différentes ; le verrou se relâche quand le
  // $transaction() englobant se termine.
  function createFakeAdvisoryLockPrisma() {
    const products: any[] = [];
    let createCallCount = 0;
    const locks = new Map<string, Promise<void>>();

    const $transaction = vi.fn(async (callback: any) => {
      let releaseLock: (() => void) | undefined;
      const tx: any = {
        $executeRaw: vi.fn(async (strings: TemplateStringsArray, key: string) => {
          // setOrganizationScope() passe UN seul Prisma.Sql (pas un template
          // balisé) : ce n'est pas une prise de verrou, on ne simule rien.
          // Sans ce garde, le verrou se prendrait sur la clé `undefined` et
          // les deux transactions concurrentes s'interbloqueraient.
          if (!Array.isArray(strings)) {
            return 1;
          }
          const previous = locks.get(key) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((resolve) => {
            release = resolve;
          });
          locks.set(key, previous.then(() => mine));
          await previous;
          releaseLock = release;
          return 1;
        }),
        product: {
          findFirst: vi.fn(async ({ where }: any) =>
            products.find(
              (p) =>
                p.organizationId === where.organizationId && p.name.toLowerCase() === where.name.equals.toLowerCase(),
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

      try {
        return await callback(tx);
      } finally {
        releaseLock?.();
      }
    });

    return { $transaction, products };
  }

  // Cross-Story Audit 2026-08-24, finding #3 MOYENNE-HAUTE — remplace l'ancien
  // test qui prouvait honnêtement l'ABSENCE d'effet de $transaction() seul
  // sous isolation Read Committed. Avec pg_advisory_xact_lock, le signal E3
  // est maintenant posé de façon fiable sous course réelle.
  it("Cross-Story Audit 2026-08-24, finding #3 — sous deux create() réellement concurrents du même nom, le verrou consultatif sérialise et pose correctement le signal chez le second", async () => {
    const { $transaction, products } = createFakeAdvisoryLockPrisma();
    const prisma: any = { $transaction };
    const service = new ProductsService(prisma);

    const [resultA, resultB]: any[] = await Promise.all([
      service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1"),
      service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1"),
    ]);

    expect(products).toHaveLength(2);
    const results = [resultA, resultB];
    const withSignal = results.filter((r) => r.possibleDuplicateOf !== null);
    const withoutSignal = results.filter((r) => r.possibleDuplicateOf === null);
    // Exactement UNE des deux créations pose maintenant le signal — plus les
    // deux "null" que produisait l'ancien fix ($transaction seul).
    expect(withSignal).toHaveLength(1);
    expect(withoutSignal).toHaveLength(1);
    expect(withSignal[0].possibleDuplicateOf).toBe(withoutSignal[0].id);
  });

  it("Cross-Story Audit 2026-08-24, finding #3 (verrou consultatif) — deux create() concurrents pour des noms DIFFÉRENTS ne se bloquent jamais l'un l'autre", async () => {
    const { $transaction, products } = createFakeAdvisoryLockPrisma();
    const prisma: any = { $transaction };
    const service = new ProductsService(prisma);

    const [resultA, resultB]: any[] = await Promise.all([
      service.create({ organizationId: "org-1", name: "Riz 25kg" }, "org-1"),
      service.create({ organizationId: "org-1", name: "Sucre 1kg" }, "org-1"),
    ]);

    expect(products).toHaveLength(2);
    expect(resultA.possibleDuplicateOf).toBeNull();
    expect(resultB.possibleDuplicateOf).toBeNull();
  });
});

describe("ProductsService.setCostPrice (E6, ADR-084)", () => {
  it("met à jour costPrice sur le produit ciblé", async () => {
    const prisma = createFakePrisma();
    const service = new ProductsService(prisma as any);

    const result = await service.setCostPrice("product-1", 15_000n, "org-1");

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { costPrice: 15_000n },
    });
    expect(result.costPrice).toBe(15_000n);
  });
});

// Gap produit comblé ici — aucun GET /products n'existait jusqu'ici (seul
// POST /products, E10). Même convention de pagination que
// CustomersService.findAllByOrganization (DEFAULT_LIST_PAGE_SIZE=50,
// MAX_LIST_PAGE_SIZE=100). orderBy name (pas createdAt : Product n'a pas ce
// champ, contrairement à Customer) — s'appuie sur le nouvel index composite
// product_organization_id_name_idx.
describe("ProductsService.findAllByOrganization", () => {
  it("liste les produits de l'organisation, triés par nom, paginés avec une limite par défaut", async () => {
    const prisma: any = auClientScope({
      product: { findMany: vi.fn().mockResolvedValue([{ id: "product-1" }, { id: "product-2" }]) },
    });
    const service = new ProductsService(prisma as any);

    const result = await service.findAllByOrganization("org-1", {});

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { name: "asc" },
      take: 50,
      skip: 0,
    });
    expect(result).toEqual([{ id: "product-1" }, { id: "product-2" }]);
  });

  it("plafonne take à 100 quel que soit ce que l'appelant demande", async () => {
    const prisma: any = auClientScope({ product: { findMany: vi.fn().mockResolvedValue([]) } });
    const service = new ProductsService(prisma as any);

    await service.findAllByOrganization("org-1", { take: 500 });

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("respecte take/skip explicitement fournis", async () => {
    const prisma: any = auClientScope({ product: { findMany: vi.fn().mockResolvedValue([]) } });
    const service = new ProductsService(prisma as any);

    await service.findAllByOrganization("org-1", { take: 10, skip: 20 });

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, skip: 20 }));
  });
});

// Gap produit comblé ici — écran détail produit (UI, backlog gap). Même
// pattern que CustomersService.findOneWithBalance : duplicateOf {id, name}
// résolu pour afficher un nom lisible du candidat doublon plutôt que le seul
// UUID possibleDuplicateOf déjà exposé par la liste. Jamais une fusion :
// ProductsService.merge() n'existe pas (E3, décision actée — la fusion n'est
// demandée par le Backlog que pour les clients, E4).
describe("ProductsService.findOneWithDuplicate", () => {
  it("inclut duplicateOf {id, name} quand possibleDuplicateOf est renseigné", async () => {
    const prisma: any = auClientScope({
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "product-1",
          organizationId: "org-1",
          name: "Riz 25kg (ressaisie)",
          costPrice: null,
          possibleDuplicateOf: "product-existant",
          duplicateOf: { id: "product-existant", name: "Riz 25kg" },
        }),
      },
    });
    const service = new ProductsService(prisma as any);

    const result: any = await service.findOneWithDuplicate("product-1", "org-1");

    // findFirstOrThrow est adossé à findUniqueOrThrow par auClientScope() :
    // même espion, mais le `where` porte maintenant l'organisation.
    expect(prisma.product.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "product-1", organizationId: "org-1" },
      include: { duplicateOf: { select: { id: true, name: true } } },
    });
    expect(result.duplicateOf).toEqual({ id: "product-existant", name: "Riz 25kg" });
  });

  it("laisse duplicateOf null quand possibleDuplicateOf est null (aucun doublon détecté)", async () => {
    const prisma: any = auClientScope({
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "product-1",
          organizationId: "org-1",
          name: "Sucre 1kg",
          costPrice: 5_000n,
          possibleDuplicateOf: null,
          duplicateOf: null,
        }),
      },
    });
    const service = new ProductsService(prisma as any);

    const result: any = await service.findOneWithDuplicate("product-1", "org-1");

    expect(result.duplicateOf).toBeNull();
    expect(result.costPrice).toBe(5_000n);
  });
});
