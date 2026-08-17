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
  function createFakePrismaForMerge(canonical: any, duplicate: any) {
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
});

describe("CustomersService — marquage entité publique (F16, ADR-105)", () => {
  it("pose isPublicEntity=true et publicBuyerAccountId sur un client existant", async () => {
    const prisma = createFakePrisma();
    const service = new CustomersService(prisma as any);

    const result = await service.flagPublicEntity("cust-1", "pba-1");

    expect(prisma.publicBuyerAccount.findUnique).toHaveBeenCalledWith({ where: { id: "pba-1" } });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { isPublicEntity: true, publicBuyerAccountId: "pba-1" },
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
