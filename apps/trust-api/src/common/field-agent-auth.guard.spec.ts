import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { FieldAgentAuthGuard } from "./field-agent-auth.guard";

function buildContext(headers: Record<string, string>) {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("FieldAgentAuthGuard (accorde le statut agent terrain, B5)", () => {
  afterEach(() => {
    delete process.env.FIELD_AGENT_GRANT_INTERNAL_KEY;
  });

  it("lève une erreur au constructeur si FIELD_AGENT_GRANT_INTERNAL_KEY n'est pas configurée", () => {
    delete process.env.FIELD_AGENT_GRANT_INTERNAL_KEY;

    expect(() => new FieldAgentAuthGuard()).toThrow(/FIELD_AGENT_GRANT_INTERNAL_KEY/);
  });

  it("refuse une requête sans en-tête X-Internal-Api-Key", () => {
    process.env.FIELD_AGENT_GRANT_INTERNAL_KEY = "secret-field-agent-de-dev";
    const guard = new FieldAgentAuthGuard();

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it("refuse une clé incorrecte", () => {
    process.env.FIELD_AGENT_GRANT_INTERNAL_KEY = "secret-field-agent-de-dev";
    const guard = new FieldAgentAuthGuard();

    expect(() => guard.canActivate(buildContext({ "x-internal-api-key": "mauvaise-cle" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("refuse la clé DGI_VERIFICATION_INTERNAL_KEY d'un autre périmètre de confiance", () => {
    process.env.FIELD_AGENT_GRANT_INTERNAL_KEY = "secret-field-agent-de-dev";
    const guard = new FieldAgentAuthGuard();

    expect(() =>
      guard.canActivate(buildContext({ "x-internal-api-key": "secret-dgi-de-dev" })),
    ).toThrow(UnauthorizedException);
  });

  it("autorise la clé exacte", () => {
    process.env.FIELD_AGENT_GRANT_INTERNAL_KEY = "secret-field-agent-de-dev";
    const guard = new FieldAgentAuthGuard();

    expect(guard.canActivate(buildContext({ "x-internal-api-key": "secret-field-agent-de-dev" }))).toBe(true);
  });
});
