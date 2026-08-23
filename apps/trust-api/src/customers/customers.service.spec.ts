import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CustomersService } from "./customers.service";

function createFakePrisma(
  overrides: { customer?: any; invoice?: any; publicBuyerAccount?: any } = {},
) {
  return {
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
  it("pose isPublicEntity=true et publicBuyerAccountId sur un client existant", async () => {
    const prisma = createFakePrisma();
    const service = new CustomersService(prisma as any);

    const result = await service.flagPublicEntity("cust-1", "pba-1");

    expect(prisma.publicBuyerAccount.findUnique).toHaveBeenCalledWith({ where: { id: "pba-1" } });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { isPublicEntity: true, publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: false },
    });
    expect(result.isPublicEntity).toBe(true);
    expect(result.publicBuyerAccountId).toBe("pba-1");
  });

  it("rejette un publicBuyerAccountId qui ne correspond à aucun compte", async () => {
    const prisma = createFakePrisma({ publicBuyerAccount: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new CustomersService(prisma as any);

    await expect(service.flagPublicEntity("cust-1", "pba-inconnu")).rejects.toThrow(/introuvable/);
    expect(prisma.customer.update).not.toHaveBeenCalled();
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
