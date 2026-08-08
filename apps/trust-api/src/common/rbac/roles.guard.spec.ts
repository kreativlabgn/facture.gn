import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RolesGuard } from "./roles.guard";

function createReflector(roles: string[] | undefined) {
  return { getAllAndOverride: vi.fn().mockReturnValue(roles) } as any;
}

function buildContext({ user, body = {}, params = {} }: any) {
  const request: any = { user, body, params };
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
});
