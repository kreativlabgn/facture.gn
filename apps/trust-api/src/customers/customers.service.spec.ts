import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CustomersService } from "./customers.service";

function createFakePrisma(
  overrides: { customer?: any; invoice?: any; publicBuyerAccount?: any } = {},
) {
  const prisma: any = {
    // Cross-Story Audit 2026-08-24, finding #3 — create() englobe désormais
    // findFirst+create dans une transaction ; ce helper générique (utilisé par
    // create()/findOneWithBalance()/flagPublicEntity()) doit donc lui aussi
    // exposer $transaction pour rester réutilisable par les tests de create().
    $transaction: vi.fn((callback: any) => callback(prisma)),
    customer: {
      create: vi.fn().mockResolvedValue({
        id: "cust-1",
        organizationId: "org-1",
        name: "Épicerie Sory",
        phone: null,
        nif: null,
        creditLimit: null,
        createdAt: new Date("2026-08-09T00:00:00.000Z"),
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "cust-1",
        organizationId: "org-1",
        name: "Épicerie Sory",
        phone: null,
        nif: null,
        creditLimit: null,
        createdAt: new Date("2026-08-09T00:00:00.000Z"),
      }),
      update: vi.fn().mockResolvedValue({
        id: "cust-1",
        organizationId: "org-1",
        isPublicEntity: true,
        publicBuyerAccountId: "pba-1",
      }),
      ...overrides.customer,
    },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountDue: null } }),
      ...overrides.invoice,
    },
    publicBuyerAccount: {
      findUnique: vi.fn().mockResolvedValue({ id: "pba-1", name: "Ministère des Finances" }),
      ...overrides.publicBuyerAccount,
    },
  };
  return prisma;
}

describe("CustomersService — création (C6, ADR-039)", () => {
  it("crée un client avec les champs fournis", async () => {
    const prisma = createFakePrisma();
    const service = new CustomersService(prisma as any);

    const result = await service.create({
      organizationId: "org-1",
      name: "Épicerie Sory",
    } as any);

    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        name: "Épicerie Sory",
        phone: undefined,
        nif: undefined,
        creditLimit: undefined,
        notificationChannel: undefined,
        possibleDuplicateOf: null,
      },
    });
    expect(result.id).toBe("cust-1");
  });

  it("ne fabrique jamais un creditLimit par défaut — reste null si absent du DTO", async () => {
    const prisma = createFakePrisma();
    const service = new CustomersService(prisma as any);

    const result = await service.create({ organizationId: "org-1", name: "Épicerie Sory" } as any);

    expect(result.creditLimit).toBeNull();
  });
});

describe("CustomersService — dédoublonnage à la création unitaire (E3, ADR-038)", () => {
  function createFakePrismaForCreate(opts: { existingMatch?: any } = {}) {
    let createCallCount = 0;
    const prisma: any = {
      // Cross-Story Audit 2026-08-24, finding #3 — create() englobe désormais
      // findFirst+create dans une transaction : callback(prisma) réutilise
      // directement les mêmes mocks customer.findFirst/create (tx === prisma
      // ici), même pattern que createFakePrismaForMerge()/createFakePrismaForFlag()
      // plus bas dans ce fichier.
      $transaction: vi.fn((callback: any) => callback(prisma)),
      // Cross-Story Audit 2026-08-24, finding #3 (verrou consultatif) —
      // pg_advisory_xact_lock posé via $queryRaw avant le findFirst. Resolved
      // par défaut ici (aucune contention simulée) — voir le test de
      // concurrence dédié plus bas pour un $queryRaw qui simule réellement le
      // verrou.
      $queryRaw: vi.fn().mockResolvedValue([]),
      customer: {
        // findFirst simule fidèlement le filtrage Prisma réel sur organizationId : un
        // existingMatch configuré pour une AUTRE organisation que celle demandée dans le
        // `where` n'est jamais retourné — preuve du scoping organizationId (voir test
        // dédié "AUTRE organisation" ci-dessous). Rétrocompatible : un existingMatch sans
        // organizationId n'est jamais filtré (comportement des tests existants inchangé).
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          const match = opts.existingMatch;
          if (!match) return Promise.resolve(null);
          if (match.organizationId && match.organizationId !== where.organizationId) {
            return Promise.resolve(null);
          }
          return Promise.resolve(match);
        }),
        create: vi.fn().mockImplementation(({ data }: any) => {
          createCallCount += 1;
          return Promise.resolve({ id: `cust-new-${createCallCount}`, ...data });
        }),
        // Déclarés explicitement (pas juste absents) pour que les assertions
        // `.not.toHaveBeenCalled()` ci-dessous protègent vraiment ADR-038 au lieu de
        // reposer "par accident" sur l'absence de la méthode sur le mock.
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    return prisma;
  }

  it("pose possibleDuplicateOf quand le téléphone matche un client déjà en base de l'organisation", async () => {
    const prisma = createFakePrismaForCreate({ existingMatch: { id: "cust-existant", phone: "+224622334455" } });
    const service = new CustomersService(prisma as any);

    const result: any = await service.create({
      organizationId: "org-1",
      name: "Boutique Fanta (ressaisie après coupure)",
      phone: "+224622334455",
    } as any);

    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", phone: "+224622334455" },
    });
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ possibleDuplicateOf: "cust-existant" }),
    });
    expect(result.possibleDuplicateOf).toBe("cust-existant");
  });

  it("laisse possibleDuplicateOf null quand aucun client de l'organisation ne partage ce téléphone", async () => {
    const prisma = createFakePrismaForCreate();
    const service = new CustomersService(prisma as any);

    const result: any = await service.create({
      organizationId: "org-1",
      name: "Boutique Sory",
      phone: "+224622334455",
    } as any);

    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ possibleDuplicateOf: null }),
    });
    expect(result.possibleDuplicateOf).toBeNull();
  });

  it("laisse possibleDuplicateOf null quand le seul client partageant ce téléphone appartient à une AUTRE organisation", async () => {
    const prisma = createFakePrismaForCreate({
      existingMatch: { id: "cust-autre-org", organizationId: "org-2", phone: "+224622334455" },
    });
    const service = new CustomersService(prisma as any);

    const result: any = await service.create({
      organizationId: "org-1",
      name: "Boutique Fanta",
      phone: "+224622334455",
    } as any);

    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ possibleDuplicateOf: null }),
    });
    expect(result.possibleDuplicateOf).toBeNull();
  });

  it("ne modifie ni ne supprime jamais l'enregistrement existant trouvé (ADR-038)", async () => {
    const prisma = createFakePrismaForCreate({ existingMatch: { id: "cust-existant", phone: "+224622334455" } });
    const service = new CustomersService(prisma as any);

    await service.create({
      organizationId: "org-1",
      name: "Boutique Fanta (ressaisie après coupure)",
      phone: "+224622334455",
    } as any);

    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.delete).not.toHaveBeenCalled();
  });

  it("ne fait aucune recherche de doublon quand le téléphone est absent — reste null", async () => {
    const prisma = createFakePrismaForCreate();
    const service = new CustomersService(prisma as any);

    const result: any = await service.create({ organizationId: "org-1", name: "Boutique Sory" } as any);

    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    // Cross-Story Audit 2026-08-24, finding #3 (verrou consultatif) — aucun
    // téléphone, rien à sérialiser : le verrou n'a de sens que pour la clé de
    // dédoublonnage (organizationId+phone), jamais posé quand elle n'existe pas.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ possibleDuplicateOf: null }),
    });
    expect(result.possibleDuplicateOf).toBeNull();
  });

  // Simule fidèlement pg_advisory_xact_lock(hashtext(clé)) : une Map<clé,
  // Promise> sérialise les appelants partageant la MÊME clé (le second attend
  // que le premier ait fini) et n'affecte jamais deux clés différentes (Map
  // indépendante par clé). Le verrou est relâché quand le $transaction()
  // englobant se termine (succès ou échec) — jamais un unlock explicite,
  // exactement la sémantique `_xact_` réelle de Postgres.
  function createFakeAdvisoryLockPrisma() {
    const customers: any[] = [];
    let createCallCount = 0;
    const locks = new Map<string, Promise<void>>();

    const $transaction = vi.fn(async (callback: any) => {
      let releaseLock: (() => void) | undefined;
      const tx: any = {
        $queryRaw: vi.fn(async (_strings: TemplateStringsArray, key: string) => {
          const previous = locks.get(key) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((resolve) => {
            release = resolve;
          });
          locks.set(key, previous.then(() => mine));
          await previous;
          releaseLock = release;
          return [];
        }),
        customer: {
          findFirst: vi.fn(async ({ where }: any) =>
            customers.find((c) => c.organizationId === where.organizationId && c.phone === where.phone) ?? null,
          ),
          create: vi.fn(async ({ data }: any) => {
            createCallCount += 1;
            const row = { id: `cust-race-${createCallCount}`, ...data };
            customers.push(row);
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

    return { $transaction, customers };
  }

  // Cross-Story Audit 2026-08-24, finding #3 MOYENNE-HAUTE — remplace
  // l'ancien test qui prouvait honnêtement l'ABSENCE d'effet de
  // $transaction() seul sous isolation Read Committed (possibleDuplicateOf
  // null des deux côtés). Avec pg_advisory_xact_lock, la seconde création
  // attend que la première commite avant de lancer son propre findFirst — le
  // signal E3 est maintenant posé de façon fiable sous course réelle.
  it("Cross-Story Audit 2026-08-24, finding #3 — sous deux create() réellement concurrents du même téléphone, le verrou consultatif sérialise et pose correctement le signal chez le second", async () => {
    const { $transaction, customers } = createFakeAdvisoryLockPrisma();
    const prisma: any = { $transaction };
    const service = new CustomersService(prisma);

    const [resultA, resultB]: any[] = await Promise.all([
      service.create({ organizationId: "org-1", name: "Boutique Fanta (agent 1)", phone: "+224622334455" } as any),
      service.create({ organizationId: "org-1", name: "Boutique Fanta (agent 2, ressaisie)", phone: "+224622334455" } as any),
    ]);

    // Les deux créations réussissent toujours (aucun blocage définitif, aucune
    // erreur) — E3 ne bloque jamais une création, contrairement à une
    // contrainte unique stricte : le verrou sérialise, il ne rejette rien.
    expect(customers).toHaveLength(2);

    const results = [resultA, resultB];
    const withSignal = results.filter((r) => r.possibleDuplicateOf !== null);
    const withoutSignal = results.filter((r) => r.possibleDuplicateOf === null);
    // Exactement UNE des deux créations pose maintenant le signal — plus les
    // deux "null" que produisait l'ancien fix ($transaction seul).
    expect(withSignal).toHaveLength(1);
    expect(withoutSignal).toHaveLength(1);
    // Et ce signal pointe bien vers l'AUTRE création (le premier gagnant du verrou).
    expect(withSignal[0].possibleDuplicateOf).toBe(withoutSignal[0].id);
  });

  it("Cross-Story Audit 2026-08-24, finding #3 (verrou consultatif) — deux create() concurrents pour des téléphones DIFFÉRENTS ne se bloquent jamais l'un l'autre", async () => {
    const { $transaction, customers } = createFakeAdvisoryLockPrisma();
    const prisma: any = { $transaction };
    const service = new CustomersService(prisma);

    const [resultA, resultB]: any[] = await Promise.all([
      service.create({ organizationId: "org-1", name: "Boutique Fanta", phone: "+224622334455" } as any),
      service.create({ organizationId: "org-1", name: "Boutique Sory", phone: "+224699887766" } as any),
    ]);

    expect(customers).toHaveLength(2);
    // Clés de verrou différentes (téléphones différents) : ni l'une ni l'autre
    // n'a de raison de voir un doublon — jamais un blocage croisé entre deux
    // clients réellement différents.
    expect(resultA.possibleDuplicateOf).toBeNull();
    expect(resultB.possibleDuplicateOf).toBeNull();
  });
});

describe("CustomersService — solde calculé à la volée (C6, ADR-039)", () => {
  it("retourne runningBalance = 0 pour un client sans facture", async () => {
    const prisma = createFakePrisma({
      invoice: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountDue: null } }) },
    });
    const service = new CustomersService(prisma as any);

    const result = await service.findOneWithBalance("cust-1");

    expect(result.runningBalance).toBe(0n);
  });

  it("agrège amountDue sur les factures issued/partially_paid uniquement", async () => {
    const prisma = createFakePrisma({
      invoice: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountDue: 750_000n } }) },
    });
    const service = new CustomersService(prisma as any);

    const result = await service.findOneWithBalance("cust-1");

    expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
      where: { customerId: "cust-1", status: { in: ["issued", "partially_paid"] } },
      _sum: { amountDue: true },
    });
    expect(result.runningBalance).toBe(750_000n);
  });
});

describe("CustomersService — écran détail, résolution du nom du doublon candidat (E4/E9, ADR-038)", () => {
  it("inclut duplicateOf {id, name} quand possibleDuplicateOf est renseigné", async () => {
    const prisma = createFakePrisma({
      customer: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "cust-1",
          organizationId: "org-1",
          name: "Boutique Fanta (ressaisie après coupure)",
          possibleDuplicateOf: "cust-existant",
          duplicateOf: { id: "cust-existant", name: "Boutique Fanta" },
        }),
      },
    });
    const service = new CustomersService(prisma as any);

    const result: any = await service.findOneWithBalance("cust-1");

    expect(prisma.customer.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      include: { duplicateOf: { select: { id: true, name: true } } },
    });
    expect(result.duplicateOf).toEqual({ id: "cust-existant", name: "Boutique Fanta" });
  });

  it("laisse duplicateOf null quand possibleDuplicateOf est null (aucun doublon détecté)", async () => {
    const prisma = createFakePrisma({
      customer: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "cust-1",
          organizationId: "org-1",
          name: "Boutique Sory",
          possibleDuplicateOf: null,
          duplicateOf: null,
        }),
      },
    });
    const service = new CustomersService(prisma as any);

    const result: any = await service.findOneWithBalance("cust-1");

    expect(result.duplicateOf).toBeNull();
  });
});

describe("CustomersService — fusion de doublons (E4, ADR-038)", () => {
  function createFakePrismaForMerge(canonical: any, duplicate: any, organization?: any) {
    const tx = {
      invoice: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      customer: {
        delete: vi.fn().mockResolvedValue(duplicate),
        findUniqueOrThrow: vi.fn().mockResolvedValue(canonical),
      },
    };
    return {
      customer: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(canonical),
        findUnique: vi.fn().mockResolvedValue(duplicate),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(organization ?? { id: "org-1", commercialTier: "pro" }),
      },
      $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
      __tx: tx,
    };
  }

  it("réassigne toutes les factures du doublon vers le canonique puis supprime le doublon", async () => {
    const canonical = { id: "cust-1", organizationId: "org-1" };
    const duplicate = { id: "cust-2", organizationId: "org-1" };
    const prisma = createFakePrismaForMerge(canonical, duplicate);
    const service = new CustomersService(prisma as any);

    await service.merge("cust-1", "cust-2");

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { customerId: "cust-2" },
      data: { customerId: "cust-1" },
    });
    expect(prisma.__tx.customer.delete).toHaveBeenCalledWith({ where: { id: "cust-2" } });
  });

  it("rejette si le doublon appartient à une AUTRE organisation", async () => {
    const canonical = { id: "cust-1", organizationId: "org-1" };
    const duplicate = { id: "cust-2", organizationId: "org-2" };
    const prisma = createFakePrismaForMerge(canonical, duplicate);
    const service = new CustomersService(prisma as any);

    await expect(service.merge("cust-1", "cust-2")).rejects.toThrow(/introuvable pour cette organisation/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette une fusion d'un client avec lui-même", async () => {
    const canonical = { id: "cust-1", organizationId: "org-1" };
    const prisma = createFakePrismaForMerge(canonical, canonical);
    const service = new CustomersService(prisma as any);

    await expect(service.merge("cust-1", "cust-1")).rejects.toThrow(/lui-même/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette si le doublon n'existe pas", async () => {
    const canonical = { id: "cust-1", organizationId: "org-1" };
    const prisma = createFakePrismaForMerge(canonical, null);
    const service = new CustomersService(prisma as any);

    await expect(service.merge("cust-1", "cust-inconnu")).rejects.toThrow(/introuvable pour cette organisation/);
  });

  it("rejette la fusion en Freemium (gestion client avancée réservée Pro+, H1)", async () => {
    const canonical = { id: "cust-1", organizationId: "org-1" };
    const duplicate = { id: "cust-2", organizationId: "org-1" };
    const prisma = createFakePrismaForMerge(canonical, duplicate, { id: "org-1", commercialTier: "freemium" });
    const service = new CustomersService(prisma as any);

    await expect(service.merge("cust-1", "cust-2")).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("CustomersService — marquage entité publique (F16, ADR-105)", () => {
  // Security Audit 2026-08-23, revue post-fix #1 (finding #1 CRITIQUE) —
  // flagPublicEntity() passe désormais par $transaction (réinitialise aussi
  // Invoice.validatedByAdministration en plus du customer), même pattern que
  // createFakePrismaForMerge() ci-dessus.
  function createFakePrismaForFlag(overrides: { publicBuyerAccount?: any } = {}) {
    const tx = {
      customer: {
        update: vi.fn().mockResolvedValue({
          id: "cust-1",
          organizationId: "org-1",
          isPublicEntity: true,
          publicBuyerAccountId: "pba-1",
        }),
      },
      invoice: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    return {
      publicBuyerAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: "pba-1", name: "Ministère des Finances" }),
        ...overrides.publicBuyerAccount,
      },
      customer: { update: vi.fn() }, // jamais appelé directement — uniquement via tx, voir assertions ci-dessous
      $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
      __tx: tx,
    };
  }

  it("pose isPublicEntity=true et publicBuyerAccountId sur un client existant", async () => {
    const prisma = createFakePrismaForFlag();
    const service = new CustomersService(prisma as any);

    const result = await service.flagPublicEntity("cust-1", "pba-1");

    expect(prisma.publicBuyerAccount.findUnique).toHaveBeenCalledWith({ where: { id: "pba-1" } });
    expect(prisma.__tx.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { isPublicEntity: true, publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: false },
    });
    expect(result.isPublicEntity).toBe(true);
    expect(result.publicBuyerAccountId).toBe("pba-1");
  });

  it("réinitialise validatedByAdministration sur les factures déjà validées lors d'un repointage (Security Audit 2026-08-23, revue post-fix #1, finding #1 CRITIQUE) — ferme le contournement par repointage post-validation", async () => {
    const prisma = createFakePrismaForFlag();
    const service = new CustomersService(prisma as any);

    await service.flagPublicEntity("cust-1", "pba-1");

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { customerId: "cust-1", validatedByAdministration: true },
      data: { validatedByAdministration: false },
    });
  });

  it("rejette un publicBuyerAccountId qui ne correspond à aucun compte", async () => {
    const prisma = createFakePrismaForFlag({ publicBuyerAccount: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new CustomersService(prisma as any);

    await expect(service.flagPublicEntity("cust-1", "pba-inconnu")).rejects.toThrow(/introuvable/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("CustomersService — proposeCreditLimit (E5, ADR-083)", () => {
  function createFakePrismaForCreditLimit(opts: {
    customer?: any;
    organization?: any;
  } = {}) {
    return {
      customer: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          opts.customer ?? { id: "cust-1", organizationId: "org-1", creditLimit: 1_000_000n },
        ),
        update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          opts.organization ?? { id: "org-1", creditLimitApprovalThreshold: 2_000_000n, commercialTier: "pro" },
        ),
      },
      creditLimitChangeRequest: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "clcr-1", status: "pending", ...data })),
      },
    };
  }

  it("applique la hausse immédiatement quand elle reste sous le seuil configuré de l'organisation", async () => {
    const prisma = createFakePrismaForCreditLimit();
    const service = new CustomersService(prisma as any);

    const result: any = await service.proposeCreditLimit("cust-1", 2_500_000n, "user-1");

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { creditLimit: 2_500_000n },
    });
    expect(prisma.creditLimitChangeRequest.create).not.toHaveBeenCalled();
    expect(result.creditLimit).toBe(2_500_000n);
  });

  it("met la hausse en attente d'approbation quand elle dépasse le seuil, sans toucher au client", async () => {
    const prisma = createFakePrismaForCreditLimit();
    const service = new CustomersService(prisma as any);

    const result: any = await service.proposeCreditLimit("cust-1", 5_000_000n, "user-1");

    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.creditLimitChangeRequest.create).toHaveBeenCalledWith({
      data: {
        customerId: "cust-1",
        organizationId: "org-1",
        requestedByUserId: "user-1",
        currentLimit: 1_000_000n,
        requestedLimit: 5_000_000n,
      },
    });
    expect(result.status).toBe("pending");
  });

  it("applique toujours immédiatement une BAISSE de limite, même importante", async () => {
    const prisma = createFakePrismaForCreditLimit();
    const service = new CustomersService(prisma as any);

    const result: any = await service.proposeCreditLimit("cust-1", 100_000n, "user-1");

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { creditLimit: 100_000n },
    });
    expect(prisma.creditLimitChangeRequest.create).not.toHaveBeenCalled();
    expect(result.creditLimit).toBe(100_000n);
  });

  it("retombe sur le seuil par défaut quand l'organisation n'a pas configuré de seuil", async () => {
    const prisma = createFakePrismaForCreditLimit({
      organization: { id: "org-1", creditLimitApprovalThreshold: null, commercialTier: "pro" },
    });
    const service = new CustomersService(prisma as any);

    // Hausse de 1_000_000n → 12_000_000n = +11_000_000n, au-delà du défaut (10_000_000n).
    const result: any = await service.proposeCreditLimit("cust-1", 12_000_000n, "user-1");

    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.creditLimitChangeRequest.create).toHaveBeenCalled();
    expect(result.status).toBe("pending");
  });

  it("rejette proposeCreditLimit en Starter (gestion client avancée réservée Pro+, H1)", async () => {
    const prisma = createFakePrismaForCreditLimit({
      organization: { id: "org-1", creditLimitApprovalThreshold: 2_000_000n, commercialTier: "starter" },
    });
    const service = new CustomersService(prisma as any);

    await expect(service.proposeCreditLimit("cust-1", 2_500_000n, "user-1")).rejects.toThrow(ForbiddenException);
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.creditLimitChangeRequest.create).not.toHaveBeenCalled();
  });
});

describe("CustomersService — resolveCreditLimitRequest (E5, ADR-083)", () => {
  function createFakePrismaForResolve(opts: {
    request?: any;
    updateManyCount?: number;
  } = {}) {
    const tx = {
      creditLimitChangeRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
      },
      customer: {
        update: vi.fn().mockResolvedValue({ id: "cust-1", creditLimit: 5_000_000n }),
      },
    };
    return {
      creditLimitChangeRequest: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          opts.request ?? {
            id: "clcr-1",
            customerId: "cust-1",
            organizationId: "org-1",
            requestedByUserId: "user-1",
            requestedLimit: 5_000_000n,
            status: "pending",
          },
        ),
      },
      $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
      __tx: tx,
    };
  }

  it("applique creditLimit au montant demandé et passe le statut à approved", async () => {
    const prisma = createFakePrismaForResolve();
    const service = new CustomersService(prisma as any);

    await service.resolveCreditLimitRequest("clcr-1", "user-2", "approved");

    expect(prisma.__tx.creditLimitChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "clcr-1", status: "pending" },
      data: { status: "approved", resolvedAt: expect.any(Date), resolvedByUserId: "user-2" },
    });
    expect(prisma.__tx.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { creditLimit: 5_000_000n },
    });
  });

  it("ne touche jamais creditLimit sur rejet", async () => {
    const prisma = createFakePrismaForResolve();
    const service = new CustomersService(prisma as any);

    await service.resolveCreditLimitRequest("clcr-1", "user-2", "rejected");

    expect(prisma.__tx.creditLimitChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "clcr-1", status: "pending" },
      data: { status: "rejected", resolvedAt: expect.any(Date), resolvedByUserId: "user-2" },
    });
    expect(prisma.__tx.customer.update).not.toHaveBeenCalled();
  });

  it("refuse que le demandeur approuve sa propre demande", async () => {
    const prisma = createFakePrismaForResolve({
      request: {
        id: "clcr-1",
        customerId: "cust-1",
        organizationId: "org-1",
        requestedByUserId: "user-1",
        requestedLimit: 5_000_000n,
        status: "pending",
      },
    });
    const service = new CustomersService(prisma as any);

    await expect(service.resolveCreditLimitRequest("clcr-1", "user-1", "approved")).rejects.toThrow(/propre demande/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuse une double résolution concurrente de la même demande", async () => {
    const prisma = createFakePrismaForResolve({ updateManyCount: 0 });
    const service = new CustomersService(prisma as any);

    await expect(service.resolveCreditLimitRequest("clcr-1", "user-2", "approved")).rejects.toThrow(/résolue/);
    expect(prisma.__tx.customer.update).not.toHaveBeenCalled();
  });
});

describe("CustomersService — importCustomers (E9, ADR-100)", () => {
  function createFakePrismaForImport(opts: { existingCustomers?: any[] } = {}) {
    let createCallCount = 0;
    return {
      customer: {
        findMany: vi.fn().mockResolvedValue(opts.existingCustomers ?? []),
        create: vi.fn().mockImplementation(({ data }: any) => {
          createCallCount += 1;
          return Promise.resolve({ id: `cust-new-${createCallCount}`, ...data });
        }),
      },
    };
  }

  it("crée toutes les lignes d'un lot valide sans doublon, possibleDuplicateOf null partout", async () => {
    const prisma = createFakePrismaForImport();
    const service = new CustomersService(prisma as any);

    const results = await service.importCustomers("org-1", [
      { name: "Boutique Sory" },
      { name: "Boutique Fanta", phone: "+224622334455" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: "created", possibleDuplicateOf: null });
    expect(results[1]).toMatchObject({ status: "created", possibleDuplicateOf: null });
    expect(prisma.customer.create).toHaveBeenCalledTimes(2);
  });

  it("marque possibleDuplicateOf quand le téléphone matche un client déjà en base de l'organisation", async () => {
    const prisma = createFakePrismaForImport({
      existingCustomers: [{ id: "cust-existant", phone: "+224622334455" }],
    });
    const service = new CustomersService(prisma as any);

    const results = await service.importCustomers("org-1", [
      { name: "Boutique Fanta", phone: "+224622334455" },
    ]);

    expect(results[0]).toMatchObject({ status: "created", possibleDuplicateOf: "cust-existant" });
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ possibleDuplicateOf: "cust-existant" }),
    });
  });

  it("marque la seconde ligne du lot comme doublon de la première quand elles partagent le même téléphone", async () => {
    const prisma = createFakePrismaForImport();
    const service = new CustomersService(prisma as any);

    const results: any[] = await service.importCustomers("org-1", [
      { name: "Boutique Fanta", phone: "+224622334455" },
      { name: "Boutique Fanta (doublon saisie)", phone: "+224622334455" },
    ]);

    expect(results[0]).toMatchObject({ status: "created", possibleDuplicateOf: null });
    expect(results[1]).toMatchObject({ status: "created", possibleDuplicateOf: results[0].customerId });
  });

  it("pointe TOUTES les occurrences suivantes vers la PREMIÈRE ligne du lot, jamais une chaîne, quand 3+ lignes partagent le même téléphone", async () => {
    const prisma = createFakePrismaForImport();
    const service = new CustomersService(prisma as any);

    const results: any[] = await service.importCustomers("org-1", [
      { name: "Boutique Fanta", phone: "+224622334455" },
      { name: "Boutique Fanta (doublon 1)", phone: "+224622334455" },
      { name: "Boutique Fanta (doublon 2)", phone: "+224622334455" },
    ]);

    expect(results[1].possibleDuplicateOf).toBe(results[0].customerId);
    expect(results[2].possibleDuplicateOf).toBe(results[0].customerId);
  });

  it("rapporte une erreur ligne par ligne pour un nom vide, sans bloquer les autres lignes valides", async () => {
    const prisma = createFakePrismaForImport();
    const service = new CustomersService(prisma as any);

    const results: any[] = await service.importCustomers("org-1", [
      { name: "" },
      { name: "Boutique Fanta" },
    ]);

    expect(results[0]).toMatchObject({ status: "error" });
    expect(results[0].reason).toBeTruthy();
    expect(results[1]).toMatchObject({ status: "created" });
    expect(prisma.customer.create).toHaveBeenCalledTimes(1);
  });

  it("rapporte une erreur pour un téléphone mal formé, sans affecter les autres lignes", async () => {
    const prisma = createFakePrismaForImport();
    const service = new CustomersService(prisma as any);

    const results = await service.importCustomers("org-1", [
      { name: "Boutique Sory", phone: "0620000000" },
      { name: "Boutique Fanta" },
    ]);

    expect(results[0].status).toBe("error");
    expect(results[1].status).toBe("created");
  });
});

describe("findAllByOrganization", () => {
  it("liste les clients de l'organisation, paginés avec une limite par défaut", async () => {
    const prisma: any = {
      customer: { findMany: vi.fn().mockResolvedValue([{ id: "cust-1" }, { id: "cust-2" }]) },
    };
    const service = new CustomersService(prisma as any);

    const result = await service.findAllByOrganization("org-1", {});

    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { createdAt: "desc" },
      take: 50,
      skip: 0,
    });
    expect(result).toEqual([{ id: "cust-1" }, { id: "cust-2" }]);
  });

  it("plafonne take à 100 quel que soit ce que le client demande", async () => {
    const prisma: any = { customer: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new CustomersService(prisma as any);

    await service.findAllByOrganization("org-1", { take: 500 });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
