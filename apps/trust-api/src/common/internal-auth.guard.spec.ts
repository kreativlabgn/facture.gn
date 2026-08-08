import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { InternalAuthGuard } from "./internal-auth.guard";

function buildContext(headers: Record<string, string>) {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("InternalAuthGuard (trust-api — reçoit les confirmations de money-api)", () => {
  afterEach(() => {
    delete process.env.MONEY_API_INTERNAL_KEY;
  });

  it("lève une erreur au constructeur si MONEY_API_INTERNAL_KEY n'est pas configurée", () => {
    delete process.env.MONEY_API_INTERNAL_KEY;

    expect(() => new InternalAuthGuard()).toThrow(/MONEY_API_INTERNAL_KEY/);
  });

  it("refuse une requête sans en-tête X-Internal-Api-Key", () => {
    process.env.MONEY_API_INTERNAL_KEY = "secret-partage-de-dev";
    const guard = new InternalAuthGuard();

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it("refuse une clé incorrecte", () => {
    process.env.MONEY_API_INTERNAL_KEY = "secret-partage-de-dev";
    const guard = new InternalAuthGuard();

    expect(() => guard.canActivate(buildContext({ "x-internal-api-key": "mauvaise-cle" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("autorise la clé exacte", () => {
    process.env.MONEY_API_INTERNAL_KEY = "secret-partage-de-dev";
    const guard = new InternalAuthGuard();

    expect(guard.canActivate(buildContext({ "x-internal-api-key": "secret-partage-de-dev" }))).toBe(true);
  });
});
