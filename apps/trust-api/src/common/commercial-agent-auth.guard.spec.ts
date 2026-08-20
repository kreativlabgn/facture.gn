import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { CommercialAgentAuthGuard } from "./commercial-agent-auth.guard";

function buildContext(headers: Record<string, string>) {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("CommercialAgentAuthGuard (accorde le statut Agent commercial terrain, B5, ADR-107)", () => {
  afterEach(() => {
    delete process.env.COMMERCIAL_AGENT_GRANT_INTERNAL_KEY;
  });

  it("lève une erreur au constructeur si COMMERCIAL_AGENT_GRANT_INTERNAL_KEY n'est pas configurée", () => {
    delete process.env.COMMERCIAL_AGENT_GRANT_INTERNAL_KEY;

    expect(() => new CommercialAgentAuthGuard()).toThrow(/COMMERCIAL_AGENT_GRANT_INTERNAL_KEY/);
  });

  it("refuse une requête sans en-tête X-Internal-Api-Key", () => {
    process.env.COMMERCIAL_AGENT_GRANT_INTERNAL_KEY = "secret-commercial-agent-de-dev";
    const guard = new CommercialAgentAuthGuard();

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it("refuse une clé incorrecte", () => {
    process.env.COMMERCIAL_AGENT_GRANT_INTERNAL_KEY = "secret-commercial-agent-de-dev";
    const guard = new CommercialAgentAuthGuard();

    expect(() => guard.canActivate(buildContext({ "x-internal-api-key": "mauvaise-cle" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("refuse la clé DGI_VERIFICATION_INTERNAL_KEY d'un autre périmètre de confiance", () => {
    process.env.COMMERCIAL_AGENT_GRANT_INTERNAL_KEY = "secret-commercial-agent-de-dev";
    const guard = new CommercialAgentAuthGuard();

    expect(() =>
      guard.canActivate(buildContext({ "x-internal-api-key": "secret-dgi-de-dev" })),
    ).toThrow(UnauthorizedException);
  });

  it("autorise la clé exacte", () => {
    process.env.COMMERCIAL_AGENT_GRANT_INTERNAL_KEY = "secret-commercial-agent-de-dev";
    const guard = new CommercialAgentAuthGuard();

    expect(guard.canActivate(buildContext({ "x-internal-api-key": "secret-commercial-agent-de-dev" }))).toBe(true);
  });
});
