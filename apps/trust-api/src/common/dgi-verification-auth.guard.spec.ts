import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { DgiVerificationAuthGuard } from "./dgi-verification-auth.guard";

function buildContext(headers: Record<string, string>) {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("DgiVerificationAuthGuard (déclenche la vérification DGI d'une organisation, B2)", () => {
  afterEach(() => {
    delete process.env.DGI_VERIFICATION_INTERNAL_KEY;
  });

  it("lève une erreur au constructeur si DGI_VERIFICATION_INTERNAL_KEY n'est pas configurée", () => {
    delete process.env.DGI_VERIFICATION_INTERNAL_KEY;

    expect(() => new DgiVerificationAuthGuard()).toThrow(/DGI_VERIFICATION_INTERNAL_KEY/);
  });

  it("refuse une requête sans en-tête X-Internal-Api-Key", () => {
    process.env.DGI_VERIFICATION_INTERNAL_KEY = "secret-dgi-de-dev";
    const guard = new DgiVerificationAuthGuard();

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it("refuse une clé incorrecte", () => {
    process.env.DGI_VERIFICATION_INTERNAL_KEY = "secret-dgi-de-dev";
    const guard = new DgiVerificationAuthGuard();

    expect(() => guard.canActivate(buildContext({ "x-internal-api-key": "mauvaise-cle" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("refuse la clé MONEY_API_INTERNAL_KEY d'un autre périmètre de confiance", () => {
    process.env.DGI_VERIFICATION_INTERNAL_KEY = "secret-dgi-de-dev";
    const guard = new DgiVerificationAuthGuard();

    expect(() =>
      guard.canActivate(buildContext({ "x-internal-api-key": "secret-partage-money-api" })),
    ).toThrow(UnauthorizedException);
  });

  it("autorise la clé exacte", () => {
    process.env.DGI_VERIFICATION_INTERNAL_KEY = "secret-dgi-de-dev";
    const guard = new DgiVerificationAuthGuard();

    expect(guard.canActivate(buildContext({ "x-internal-api-key": "secret-dgi-de-dev" }))).toBe(true);
  });
});
