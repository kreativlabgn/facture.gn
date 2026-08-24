import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ALLOW_CLIENT_PORTAL_SCOPE_KEY } from "../common/allow-client-portal-scope.decorator";
import { FecController } from "../fec/fec.controller";
import { MandatesController } from "../mandates/mandates.controller";
import { ClientPortalController } from "../client-portal/client-portal.controller";

function buildContext({ headers = {} }: { headers?: Record<string, string> }) {
  const request: any = { headers };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { context, request };
}

// Reflector réaliste : chaque metadata key (IS_PUBLIC_KEY, ALLOW_CLIENT_PORTAL_SCOPE_KEY)
// est résolue indépendamment, comme le ferait le vrai Reflector de Nest — contrairement à
// un mock à valeur de retour unique, qui ferait répondre "false" ou "true" à TOUTE clé
// interrogée (bug qui aurait masqué le comportement réel de finding #1, résiduel).
function createFakeReflector(metadata: { isPublic?: boolean; allowClientPortalScope?: boolean } = {}) {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return metadata.isPublic ?? false;
      if (key === ALLOW_CLIENT_PORTAL_SCOPE_KEY) return metadata.allowClientPortalScope ?? false;
      return undefined;
    }),
  } as any;
}

// Security Audit 2026-08-23, finding #14 — non-révoqué par défaut, voir les
// tests dédiés plus bas pour le cas révoqué.
function createFakeTokenRevocation(overrides: { isRevoked?: ReturnType<typeof vi.fn> } = {}) {
  return { isRevoked: overrides.isRevoked ?? vi.fn().mockResolvedValue(false), revoke: vi.fn() };
}

describe("JwtAuthGuard", () => {
  it("laisse passer une route @Public() sans vérifier de token", async () => {
    const tokenService = { verify: vi.fn(), sign: vi.fn() };
    const reflector = createFakeReflector({ isPublic: true });
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokenService.verify).not.toHaveBeenCalled();
  });

  it("refuse une requête sans header Authorization", async () => {
    const tokenService = { verify: vi.fn(), sign: vi.fn() };
    const reflector = createFakeReflector();
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("refuse un token invalide ou expiré", async () => {
    const tokenService = { verify: vi.fn().mockRejectedValue(new Error("invalid")), sign: vi.fn() };
    const reflector = createFakeReflector();
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context } = buildContext({ headers: { authorization: "Bearer bad.token" } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("attache req.user (id, jti, exp) et laisse passer un token valide non révoqué", async () => {
    const tokenService = {
      verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000 }),
      sign: vi.fn(),
    };
    const reflector = createFakeReflector();
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context, request } = buildContext({ headers: { authorization: "Bearer good.token" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: "user-1", jti: "jti-1", exp: 1893456000, scope: undefined });
  });

  it("Cross-Story Audit 2026-08-24, finding #1 — propage scope depuis le payload JWT vers req.user sur une route @AllowClientPortalScope()", async () => {
    const tokenService = {
      verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
      sign: vi.fn(),
    };
    const reflector = createFakeReflector({ allowClientPortalScope: true });
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context, request } = buildContext({ headers: { authorization: "Bearer portal.token" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.scope).toBe("client_portal");
  });

  it("refuse un token par ailleurs valide mais dont le jti a été révoqué (Security Audit 2026-08-23, finding #14)", async () => {
    const tokenService = {
      verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-revoked", exp: 1893456000 }),
      sign: vi.fn(),
    };
    const reflector = createFakeReflector();
    const tokenRevocation = createFakeTokenRevocation({ isRevoked: vi.fn().mockResolvedValue(true) });
    const guard = new JwtAuthGuard(reflector, tokenService as any, tokenRevocation as any);
    const { context, request } = buildContext({ headers: { authorization: "Bearer revoked.token" } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(tokenRevocation.isRevoked).toHaveBeenCalledWith("jti-revoked");
    expect(request.user).toBeUndefined();
  });

  describe("Cross-Story Audit 2026-08-24, finding #1 (résiduel) — deny-by-default global pour scope:\"client_portal\"", () => {
    it("refuse un token scope:\"client_portal\" sur une route SANS @AllowClientPortalScope() ET sans @Roles() (ex. FecController, MandatesController — c'est exactement le trou identifié par la revue : ces contrôleurs ne passent jamais par RolesGuard)", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "victim-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
        sign: vi.fn(),
      };
      const reflector = createFakeReflector(); // ni @Public(), ni @AllowClientPortalScope()
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context } = buildContext({ headers: { authorization: "Bearer portal.token" } });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("laisse passer un token scope:\"client_portal\" sur une route @AllowClientPortalScope() (ClientPortalController)", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
        sign: vi.fn(),
      };
      const reflector = createFakeReflector({ allowClientPortalScope: true });
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context, request } = buildContext({ headers: { authorization: "Bearer portal.token" } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.scope).toBe("client_portal");
    });

    it("non-régression : un token sans scope (portée complète) reste accepté sur une route sans @AllowClientPortalScope()", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000 }),
        sign: vi.fn(),
      };
      const reflector = createFakeReflector(); // ni @AllowClientPortalScope(), sans importance ici
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context, request } = buildContext({ headers: { authorization: "Bearer full.token" } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.scope).toBeUndefined();
    });
  });

  describe("Cross-Story Audit 2026-08-24, finding #1 (résiduel) — contrôleurs réels sans @Roles() confirmés vulnérables par la revue", () => {
    // Reflector RÉEL de Nest (pas un mock) lisant les métadonnées EFFECTIVEMENT
    // posées par les décorateurs de ces contrôleurs — la revue précédente n'avait
    // testé le rejet que sur une route @Roles() (via RolesGuard) ; ces tests-ci
    // couvrent précisément le cas que le round précédent avait raté : des
    // contrôleurs qui ne déclarent JAMAIS @Roles() et qui, avant ce correctif,
    // n'étaient protégés par AUCUN check de scope.
    const reflector = new Reflector();

    function buildRealContext(getClass: any, getHandler: any, headers: Record<string, string>) {
      const request: any = { headers };
      const context: any = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => getHandler,
        getClass: () => getClass,
      };
      return { context, request };
    }

    it("refuse un token scope:\"client_portal\" sur GET /organizations/:id/fec (FecController.export, aucun @Roles(), aucun @AllowClientPortalScope())", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "victim-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
        sign: vi.fn(),
      };
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context } = buildRealContext(FecController, FecController.prototype.export, {
        authorization: "Bearer portal.token",
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("refuse un token scope:\"client_portal\" sur POST /practices/:id/mandates (MandatesController.create, aucun @Roles(), aucun @AllowClientPortalScope())", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "victim-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
        sign: vi.fn(),
      };
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context } = buildRealContext(MandatesController, MandatesController.prototype.create, {
        authorization: "Bearer portal.token",
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("refuse un token scope:\"client_portal\" sur POST /practices/:id/mandates/:mandateId/revoke (MandatesController.revoke, écriture, aucun @Roles())", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "victim-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
        sign: vi.fn(),
      };
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context } = buildRealContext(MandatesController, MandatesController.prototype.revoke, {
        authorization: "Bearer portal.token",
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("laisse passer un token scope:\"client_portal\" sur GET /client-portal/organizations (ClientPortalController, @AllowClientPortalScope())", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
        sign: vi.fn(),
      };
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context, request } = buildRealContext(
        ClientPortalController,
        ClientPortalController.prototype.listOrganizations,
        { authorization: "Bearer portal.token" },
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.scope).toBe("client_portal");
    });

    it("non-régression : un token de portée complète (scope absent) reste accepté sur FecController.export", async () => {
      const tokenService = {
        verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000 }),
        sign: vi.fn(),
      };
      const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
      const { context, request } = buildRealContext(FecController, FecController.prototype.export, {
        authorization: "Bearer full.token",
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.scope).toBeUndefined();
    });
  });
});
