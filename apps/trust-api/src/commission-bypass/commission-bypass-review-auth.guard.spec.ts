import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { CommissionBypassReviewAuthGuard } from "./commission-bypass-review-auth.guard";

function buildContext(headers: Record<string, string>) {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("CommissionBypassReviewAuthGuard (revue manuelle Squad Money, G3, ADR-091)", () => {
  afterEach(() => {
    delete process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY;
  });

  it("lève une erreur au constructeur si COMMISSION_BYPASS_REVIEW_INTERNAL_KEY n'est pas configurée", () => {
    delete process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY;

    expect(() => new CommissionBypassReviewAuthGuard()).toThrow(/COMMISSION_BYPASS_REVIEW_INTERNAL_KEY/);
  });

  it("refuse une requête sans en-tête X-Internal-Api-Key", () => {
    process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY = "secret-commission-bypass-de-dev";
    const guard = new CommissionBypassReviewAuthGuard();

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it("refuse une clé incorrecte", () => {
    process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY = "secret-commission-bypass-de-dev";
    const guard = new CommissionBypassReviewAuthGuard();

    expect(() => guard.canActivate(buildContext({ "x-internal-api-key": "mauvaise-cle" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("refuse la clé DGI_VERIFICATION_INTERNAL_KEY d'un autre périmètre de confiance", () => {
    process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY = "secret-commission-bypass-de-dev";
    const guard = new CommissionBypassReviewAuthGuard();

    expect(() =>
      guard.canActivate(buildContext({ "x-internal-api-key": "secret-dgi-de-dev" })),
    ).toThrow(UnauthorizedException);
  });

  it("autorise la clé exacte", () => {
    process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY = "secret-commission-bypass-de-dev";
    const guard = new CommissionBypassReviewAuthGuard();

    expect(guard.canActivate(buildContext({ "x-internal-api-key": "secret-commission-bypass-de-dev" }))).toBe(
      true,
    );
  });
});
