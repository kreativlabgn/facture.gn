import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BranchesService } from "./branches.service";

function createFakePrisma(overrides: { branch?: any; invoice?: any; organization?: any } = {}) {
  return {
    branch: {
      create: vi.fn().mockResolvedValue({
        id: "branch-1",
        organizationId: "org-1",
        name: "Boutique Kaloum",
        type: "boutique",
        createdAt: new Date("2026-08-09T00:00:00.000Z"),
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "branch-1",
        organizationId: "org-1",
        name: "Boutique Kaloum",
        type: "boutique",
        createdAt: new Date("2026-08-09T00:00:00.000Z"),
      }),
      count: vi.fn().mockResolvedValue(0),
      ...overrides.branch,
    },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalTtc: null } }),
      ...overrides.invoice,
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "pro" }),
      ...overrides.organization,
    },
  };
}

describe("BranchesService — création (E1, ADR-037)", () => {
  it("crée une succursale avec les champs fournis", async () => {
    const prisma = createFakePrisma();
    const service = new BranchesService(prisma as any);

    const result = await service.create({
      organizationId: "org-1",
      name: "Boutique Kaloum",
      type: "boutique",
    } as any);

    expect(prisma.branch.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", name: "Boutique Kaloum", type: "boutique" },
    });
    expect(result.id).toBe("branch-1");
  });
});

describe("BranchesService — plafond de succursales par palier commercial (H1, Grille §2)", () => {
  it("refuse une 2e succursale en Freemium (plafond = 1)", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "freemium" }) },
      branch: { count: vi.fn().mockResolvedValue(1) },
    });
    const service = new BranchesService(prisma as any);

    await expect(
      service.create({ organizationId: "org-1", name: "Boutique Matam", type: "boutique" } as any),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.branch.create).not.toHaveBeenCalled();
  });

  it("autorise la 1re succursale en Freemium", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "freemium" }) },
      branch: { count: vi.fn().mockResolvedValue(0) },
    });
    const service = new BranchesService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Boutique Kaloum", type: "boutique" } as any);

    expect(prisma.branch.create).toHaveBeenCalled();
  });

  it("refuse une 3e succursale en Starter (plafond = 2)", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "starter" }) },
      branch: { count: vi.fn().mockResolvedValue(2) },
    });
    const service = new BranchesService(prisma as any);

    await expect(
      service.create({ organizationId: "org-1", name: "Boutique Dixinn", type: "boutique" } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it("aucun plafond en Pro, même avec un grand nombre de succursales existantes", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "pro" }) },
      branch: { count: vi.fn().mockResolvedValue(50) },
    });
    const service = new BranchesService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Boutique Ratoma", type: "boutique" } as any);

    expect(prisma.branch.create).toHaveBeenCalled();
  });
});

describe("BranchesService — CA calculé à la volée (E1, ADR-037)", () => {
  it("retourne totalRevenue = 0 pour une succursale sans facture", async () => {
    const prisma = createFakePrisma({
      invoice: { aggregate: vi.fn().mockResolvedValue({ _sum: { totalTtc: null } }) },
    });
    const service = new BranchesService(prisma as any);

    const result = await service.findOneWithRevenue("branch-1");

    expect(result.totalRevenue).toBe(0n);
  });

  it("agrège totalTtc sur les factures issued/partially_paid/paid de type invoice uniquement", async () => {
    const prisma = createFakePrisma({
      invoice: { aggregate: vi.fn().mockResolvedValue({ _sum: { totalTtc: 4_500_000n } }) },
    });
    const service = new BranchesService(prisma as any);

    const result = await service.findOneWithRevenue("branch-1");

    expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
      where: {
        branchId: "branch-1",
        documentType: "invoice",
        status: { in: ["issued", "partially_paid", "paid"] },
      },
      _sum: { totalTtc: true },
    });
    expect(result.totalRevenue).toBe(4_500_000n);
  });
});
