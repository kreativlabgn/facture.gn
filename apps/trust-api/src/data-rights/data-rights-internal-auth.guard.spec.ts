import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";

import { DataRightsInternalAuthGuard } from "./data-rights-internal-auth.guard";

function buildContext(headers: Record<string, string>) {
  const request = { headers };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

describe("DataRightsInternalAuthGuard (chemin ops plateforme — droits des personnes, J2)", () => {
  afterEach(() => {
    delete process.env.DATA_RIGHTS_INTERNAL_KEY;
  });

  it("lève au constructeur si DATA_RIGHTS_INTERNAL_KEY n'est pas configurée", () => {
    delete process.env.DATA_RIGHTS_INTERNAL_KEY;
    expect(() => new DataRightsInternalAuthGuard()).toThrow(/DATA_RIGHTS_INTERNAL_KEY/);
  });

  it("refuse une requête sans en-tête", () => {
    process.env.DATA_RIGHTS_INTERNAL_KEY = "secret-data-rights-dev";
    const guard = new DataRightsInternalAuthGuard();
    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it("refuse une clé incorrecte", () => {
    process.env.DATA_RIGHTS_INTERNAL_KEY = "secret-data-rights-dev";
    const guard = new DataRightsInternalAuthGuard();
    expect(() => guard.canActivate(buildContext({ "x-internal-api-key": "mauvaise" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("autorise la clé exacte", () => {
    process.env.DATA_RIGHTS_INTERNAL_KEY = "secret-data-rights-dev";
    const guard = new DataRightsInternalAuthGuard();
    expect(guard.canActivate(buildContext({ "x-internal-api-key": "secret-data-rights-dev" }))).toBe(true);
  });
});
