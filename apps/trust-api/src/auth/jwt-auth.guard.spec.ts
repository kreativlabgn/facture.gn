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

describe("JwtAuthGuard", () => {
  it("laisse passer une route @Public() sans vérifier de token", async () => {
    const tokenService = { verify: vi.fn(), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokenService.verify).not.toHaveBeenCalled();
  });

  it("refuse une requête sans header Authorization", async () => {
    const tokenService = { verify: vi.fn(), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("refuse un token invalide ou expiré", async () => {
    const tokenService = { verify: vi.fn().mockRejectedValue(new Error("invalid")), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any);
    const { context } = buildContext({ headers: { authorization: "Bearer bad.token" } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("attache req.user (id seul) et laisse passer un token valide", async () => {
    const tokenService = { verify: vi.fn().mockResolvedValue({ sub: "user-1" }), sign: vi.fn() };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const guard = new JwtAuthGuard(reflector, tokenService as any);
    const { context, request } = buildContext({ headers: { authorization: "Bearer good.token" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: "user-1" });
  });
});
