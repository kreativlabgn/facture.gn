import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ClientPortalScopeGuard } from "./client-portal-scope.guard";

function buildContext(user: unknown) {
  const request: any = { user };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return context;
}

describe("ClientPortalScopeGuard (Cross-Story Audit 2026-08-24, finding #1)", () => {
  it("accepte un token scope:\"client_portal\"", () => {
    const guard = new ClientPortalScopeGuard();
    const context = buildContext({ id: "user-1", scope: "client_portal" });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("accepte un token de portée complète (scope absent) — ex. un owner qui consulte aussi son propre portail client", () => {
    const guard = new ClientPortalScopeGuard();
    const context = buildContext({ id: "user-1" });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("accepte l'absence de request.user (routes @Public() de ClientPortalAuthController)", () => {
    const guard = new ClientPortalScopeGuard();
    const context = buildContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("refuse tout autre scope qu'un futur scope introduirait", () => {
    const guard = new ClientPortalScopeGuard();
    const context = buildContext({ id: "user-1", scope: "ussd" });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
