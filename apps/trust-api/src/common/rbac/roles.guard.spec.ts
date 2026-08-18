import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RolesGuard } from "./roles.guard";
import { ROLES_KEY } from "./roles.decorator";

// idSource undefined par défaut : simule l'absence du décorateur @OrganizationIdSource
// sur toutes les routes existantes — RolesGuard doit alors retomber sur "invoice"
// (E8), la seule résolution qui existait avant ce décorateur.
function createReflector(
  roles: string[] | undefined,
  idSource?: "invoice" | "organization" | "credit-note" | "customer" | "branch" | "credit-limit-request",
) {
  return {
    getAllAndOverride: vi.fn((key: string) => (key === ROLES_KEY ? roles : idSource)),
  } as any;
}

function buildContext({ user, body = {}, params = {}, query = {} }: any) {
  const request: any = { user, body, params, query };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return context;
}

describe("RolesGuard", () => {
  it("laisse passer quand la route ne déclare aucun rôle requis", async () => {
    const prisma: any = { organizationMember: { findUnique: vi.fn() } };
    const guard = new RolesGuard(createReflector(undefined), prisma);
    const context = buildContext({ user: { id: "user-1" }, body: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("autorise un membre actif dont le rôle est dans la liste requise", async () => {
    const prisma: any = {
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, body: { organizationId: "org-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (403) un membre dont le rôle n'est pas dans la liste requise", async () => {
    const prisma: any = {
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "client_portal", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, body: { organizationId: "org-1" } });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("refuse (403) quand aucun membership n'existe pour cette organisation", async () => {
    const prisma: any = { organizationMember: { findUnique: vi.fn().mockResolvedValue(null) } };
    const guard = new RolesGuard(createReflector(["owner"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, body: { organizationId: "org-1" } });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("refuse (403) un membership révoqué même avec le bon rôle", async () => {
    const prisma: any = {
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: new Date() }) },
    };
    const guard = new RolesGuard(createReflector(["owner"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, body: { organizationId: "org-1" } });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("résout l'organisation depuis la facture pointée par :id quand organizationId n'est pas dans le body", async () => {
    const prisma: any = {
      invoice: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "cashier", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin", "cashier"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "invoice-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.invoice.findUnique).toHaveBeenCalledWith({ where: { id: "invoice-1" } });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (404) proprement quand la facture pointée par :id n'existe pas — jamais un 500 brut", async () => {
    const prisma: any = {
      invoice: { findUnique: vi.fn().mockResolvedValue(null) },
      organizationMember: { findUnique: vi.fn() },
    };
    const guard = new RolesGuard(createReflector(["owner"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "invoice-inconnue" } });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("résout l'organisation depuis query.organizationId pour les routes de liste (GET, ni body ni :id)", async () => {
    const prisma: any = {
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, query: { organizationId: "org-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("FAILLE CRITIQUE (corrigée) : params.id prime TOUJOURS sur un organizationId de body usurpé — un attaquant ne peut pas faire passer la vérification de rôle contre SA PROPRE organisation pour agir sur la ressource d'un AUTRE pointée par :id", async () => {
    const prisma: any = {
      invoice: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-victime" }) },
      organizationMember: {
        // Le membership de l'attaquant existe bel et bien — sur SA PROPRE
        // organisation. S'il était consulté, il passerait la vérification de rôle.
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          if (where.organizationId_userId.organizationId === "org-attaquant") {
            return Promise.resolve({ role: "owner", revokedAt: null });
          }
          return Promise.resolve(null);
        }),
      },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin", "cashier"]), prisma);
    const context = buildContext({
      user: { id: "attaquant-1" },
      params: { id: "invoice-victime" },
      body: { organizationId: "org-attaquant" },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(prisma.invoice.findUnique).toHaveBeenCalledWith({ where: { id: "invoice-victime" } });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-victime", userId: "attaquant-1" } },
    });
  });

  it("FAILLE CRITIQUE (corrigée) : params.id prime TOUJOURS sur un organizationId de query usurpé (même attaque via ?organizationId=)", async () => {
    const prisma: any = {
      invoice: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-victime" }) },
      organizationMember: {
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          if (where.organizationId_userId.organizationId === "org-attaquant") {
            return Promise.resolve({ role: "owner", revokedAt: null });
          }
          return Promise.resolve(null);
        }),
      },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin", "cashier"]), prisma);
    const context = buildContext({
      user: { id: "attaquant-1" },
      params: { id: "invoice-victime" },
      query: { organizationId: "org-attaquant" },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-victime", userId: "attaquant-1" } },
    });
  });

  it("body reste la source légitime en l'absence de params.id (création — organizationId fait partie de ce qui est créé)", async () => {
    const prisma: any = {
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, body: { organizationId: "org-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("résout params.id comme une FACTURE par défaut, en l'absence de @OrganizationIdSource (E8, non-régression)", async () => {
    const prisma: any = {
      invoice: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      organization: { findUnique: vi.fn() },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner"]), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "some-id" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.invoice.findUnique).toHaveBeenCalledWith({ where: { id: "some-id" } });
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it("résout params.id directement comme une ORGANISATION avec @OrganizationIdSource(\"organization\") (E8)", async () => {
    const prisma: any = {
      invoice: { findUnique: vi.fn() },
      organization: { findUnique: vi.fn().mockResolvedValue({ id: "org-1" }) },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"], "organization"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "org-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { id: "org-1" } });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (404) proprement quand l'organisation pointée par :id n'existe pas (E8) — jamais un 500 brut", async () => {
    const prisma: any = {
      organization: { findUnique: vi.fn().mockResolvedValue(null) },
      organizationMember: { findUnique: vi.fn() },
    };
    const guard = new RolesGuard(createReflector(["owner"], "organization"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "org-inconnue" } });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("résout params.id comme un AVOIR (CreditNote) avec @OrganizationIdSource(\"credit-note\") (C13)", async () => {
    const prisma: any = {
      creditNote: { findUnique: vi.fn().mockResolvedValue({ id: "cn-1", invoice: { organizationId: "org-1" } }) },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"], "credit-note"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "cn-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.creditNote.findUnique).toHaveBeenCalledWith({
      where: { id: "cn-1" },
      include: { invoice: true },
    });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (404) proprement quand l'avoir pointé par :id n'existe pas (C13) — jamais un 500 brut", async () => {
    const prisma: any = {
      creditNote: { findUnique: vi.fn().mockResolvedValue(null) },
      organizationMember: { findUnique: vi.fn() },
    };
    const guard = new RolesGuard(createReflector(["owner"], "credit-note"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "cn-inconnu" } });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("résout params.id comme un CLIENT avec @OrganizationIdSource(\"customer\") (C6)", async () => {
    const prisma: any = {
      customer: { findUnique: vi.fn().mockResolvedValue({ id: "cust-1", organizationId: "org-1" }) },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"], "customer"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "cust-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({ where: { id: "cust-1" } });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (404) proprement quand le client pointé par :id n'existe pas (C6) — jamais un 500 brut", async () => {
    const prisma: any = {
      customer: { findUnique: vi.fn().mockResolvedValue(null) },
      organizationMember: { findUnique: vi.fn() },
    };
    const guard = new RolesGuard(createReflector(["owner"], "customer"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "cust-inconnu" } });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("résout params.id comme une SUCCURSALE avec @OrganizationIdSource(\"branch\") (E1)", async () => {
    const prisma: any = {
      branch: { findUnique: vi.fn().mockResolvedValue({ id: "branch-1", organizationId: "org-1" }) },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "owner", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["owner", "admin"], "branch"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "branch-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "branch-1" } });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (404) proprement quand la succursale pointée par :id n'existe pas (E1) — jamais un 500 brut", async () => {
    const prisma: any = {
      branch: { findUnique: vi.fn().mockResolvedValue(null) },
      organizationMember: { findUnique: vi.fn() },
    };
    const guard = new RolesGuard(createReflector(["owner"], "branch"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "branch-inconnue" } });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("résout params.id comme une DEMANDE DE HAUSSE DE LIMITE DE CRÉDIT avec @OrganizationIdSource(\"credit-limit-request\") (E5, ADR-083)", async () => {
    const prisma: any = {
      creditLimitChangeRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: "clcr-1", organizationId: "org-1" }),
      },
      organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: "approver", revokedAt: null }) },
    };
    const guard = new RolesGuard(createReflector(["approver"], "credit-limit-request"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "clcr-1" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.creditLimitChangeRequest.findUnique).toHaveBeenCalledWith({ where: { id: "clcr-1" } });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } },
    });
  });

  it("refuse (404) proprement quand la demande de hausse de limite de crédit pointée par :id n'existe pas (E5) — jamais un 500 brut", async () => {
    const prisma: any = {
      creditLimitChangeRequest: { findUnique: vi.fn().mockResolvedValue(null) },
      organizationMember: { findUnique: vi.fn() },
    };
    const guard = new RolesGuard(createReflector(["approver"], "credit-limit-request"), prisma);
    const context = buildContext({ user: { id: "user-1" }, params: { id: "clcr-inconnue" } });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });
});
