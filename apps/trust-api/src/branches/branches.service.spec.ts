import { describe, expect, it, vi } from "vitest";
import { BranchesService } from "./branches.service";

function createFakePrisma(overrides: { branch?: any; invoice?: any } = {}) {
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
      ...overrides.branch,
    },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalTtc: null } }),
      ...overrides.invoice,
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
