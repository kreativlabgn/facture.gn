import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BranchesService } from "./branches.service";

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

function createFakePrisma(overrides: { branch?: any; invoice?: any; organization?: any } = {}) {
  return auClientScope({
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
  });
}

describe("BranchesService — création (E1, ADR-037)", () => {
  it("crée une succursale avec les champs fournis", async () => {
    const prisma = createFakePrisma();
    const service = new BranchesService(prisma as any);

    const result = await service.create({
      organizationId: "org-1",
      name: "Boutique Kaloum",
      type: "boutique",
    } as any, "org-1");

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
      service.create({ organizationId: "org-1", name: "Boutique Matam", type: "boutique" } as any, "org-1"),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.branch.create).not.toHaveBeenCalled();
  });

  it("autorise la 1re succursale en Freemium", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "freemium" }) },
      branch: { count: vi.fn().mockResolvedValue(0) },
    });
    const service = new BranchesService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Boutique Kaloum", type: "boutique" } as any, "org-1");

    expect(prisma.branch.create).toHaveBeenCalled();
  });

  it("refuse une 3e succursale en Starter (plafond = 2)", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "starter" }) },
      branch: { count: vi.fn().mockResolvedValue(2) },
    });
    const service = new BranchesService(prisma as any);

    await expect(
      service.create({ organizationId: "org-1", name: "Boutique Dixinn", type: "boutique" } as any, "org-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("aucun plafond en Pro, même avec un grand nombre de succursales existantes", async () => {
    const prisma = createFakePrisma({
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "pro" }) },
      branch: { count: vi.fn().mockResolvedValue(50) },
    });
    const service = new BranchesService(prisma as any);

    await service.create({ organizationId: "org-1", name: "Boutique Ratoma", type: "boutique" } as any, "org-1");

    expect(prisma.branch.create).toHaveBeenCalled();
  });
});

describe("BranchesService — CA calculé à la volée (E1, ADR-037)", () => {
  it("retourne totalRevenue = 0 pour une succursale sans facture", async () => {
    const prisma = createFakePrisma({
      invoice: { aggregate: vi.fn().mockResolvedValue({ _sum: { totalTtc: null } }) },
    });
    const service = new BranchesService(prisma as any);

    const result = await service.findOneWithRevenue("branch-1", "org-1");

    expect(result.totalRevenue).toBe(0n);
  });

  it("agrège totalTtc sur les factures issued/partially_paid/paid de type invoice uniquement", async () => {
    const prisma = createFakePrisma({
      invoice: { aggregate: vi.fn().mockResolvedValue({ _sum: { totalTtc: 4_500_000n } }) },
    });
    const service = new BranchesService(prisma as any);

    const result = await service.findOneWithRevenue("branch-1", "org-1");

    expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
      where: {
        branchId: "branch-1",
        organizationId: "org-1",
        documentType: "invoice",
        status: { in: ["issued", "partially_paid", "paid"] },
      },
      _sum: { totalTtc: true },
    });
    expect(result.totalRevenue).toBe(4_500_000n);
  });
});

// L'onglet Succursales des paramètres crée depuis H1 sans jamais pouvoir
// montrer : POST /branches et GET /branches/:id existaient, aucune liste. Un
// écran qui crée à l'aveugle laisse le commerçant recréer ce qu'il a déjà.
describe("BranchesService — liste des succursales", () => {
  it("liste les succursales de l'organisation, les plus anciennes d'abord", async () => {
    const prisma = createFakePrisma({
      branch: {
        findMany: vi.fn().mockResolvedValue([
          { id: "branch-1", organizationId: "org-1", name: "Boutique Kaloum", type: "boutique" },
          { id: "branch-2", organizationId: "org-1", name: "Entrepôt Matoto", type: "entrepot" },
        ]),
      },
    });
    const service = new BranchesService(prisma as any);

    const result = await service.findAllByOrganization("org-1");

    // createdAt ASC et non DESC : la liste sert à se repérer dans SA structure,
    // pas à voir la dernière nouveauté. L'ordre de création est celui que le
    // commerçant a en tête.
    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toHaveLength(2);
  });

  // Le filtre organisation n'est pas décoratif : les politiques RLS sont encore
  // dormantes (étape 2 non faite) et le rôle applicatif possède les tables. Le
  // retirer rendrait aujourd'hui les succursales de TOUS les locataires.
  it("porte le filtre organizationId, jamais un findMany nu", async () => {
    const prisma = createFakePrisma({ branch: { findMany: vi.fn().mockResolvedValue([]) } });
    const service = new BranchesService(prisma as any);

    await service.findAllByOrganization("org-1");

    const [{ where }] = prisma.branch.findMany.mock.calls[0];
    expect(where).toEqual({ organizationId: "org-1" });
  });
});
