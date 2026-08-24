import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt-auth.guard";

function buildContext({ headers = {} }: { headers?: Record<string, string> }) {
  const request: any = { headers };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { context, request };
}

// Security Audit 2026-08-23, finding #14 — non-révoqué par défaut, voir les
// tests dédiés plus bas pour le cas révoqué.
function createFakeTokenRevocation(overrides: { isRevoked?: ReturnType<typeof vi.fn> } = {}) {
  return { isRevoked: overrides.isRevoked ?? vi.fn().mockResolvedValue(false), revoke: vi.fn() };
}

describe("JwtAuthGuard", () => {
  it("laisse passer une route @Public() sans vérifier de token", async () => {
    const tokenService = { verify: vi.fn(), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokenService.verify).not.toHaveBeenCalled();
  });

  it("refuse une requête sans header Authorization", async () => {
    const tokenService = { verify: vi.fn(), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("refuse un token invalide ou expiré", async () => {
    const tokenService = { verify: vi.fn().mockRejectedValue(new Error("invalid")), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context } = buildContext({ headers: { authorization: "Bearer bad.token" } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("attache req.user (id, jti, exp) et laisse passer un token valide non révoqué", async () => {
    const tokenService = {
      verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000 }),
      sign: vi.fn(),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any, createFakeTokenRevocation() as any);
    const { context, request } = buildContext({ headers: { authorization: "Bearer good.token" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: "user-1", jti: "jti-1", exp: 1893456000 });
  });

  it("Cross-Story Audit 2026-08-24, finding #1 — propage scope depuis le payload JWT vers req.user", async () => {
    const tokenService = {
      verify: vi.fn().mockResolvedValue({ sub: "user-1", jti: "jti-1", exp: 1893456000, scope: "client_portal" }),
      sign: vi.fn(),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
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
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const tokenRevocation = createFakeTokenRevocation({ isRevoked: vi.fn().mockResolvedValue(true) });
    const guard = new JwtAuthGuard(reflector, tokenService as any, tokenRevocation as any);
    const { context, request } = buildContext({ headers: { authorization: "Bearer revoked.token" } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(tokenRevocation.isRevoked).toHaveBeenCalledWith("jti-revoked");
    expect(request.user).toBeUndefined();
  });
});
