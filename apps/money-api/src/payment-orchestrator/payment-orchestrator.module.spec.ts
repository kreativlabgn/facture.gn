import { afterEach, describe, expect, it } from "vitest";
import { resolveDjomyStubDelayMs } from "./payment-orchestrator.module";

describe("resolveDjomyStubDelayMs", () => {
  afterEach(() => {
    delete process.env.DJOMY_STUB_SIMULATED_DELAY_MS;
    delete process.env.NODE_ENV;
  });

  it("retourne 0 quand la variable n'est pas positionnée", () => {
    expect(resolveDjomyStubDelayMs()).toBe(0);
  });

  it("retourne la valeur positionnée hors production", () => {
    process.env.DJOMY_STUB_SIMULATED_DELAY_MS = "15000";
    process.env.NODE_ENV = "development";

    expect(resolveDjomyStubDelayMs()).toBe(15000);
  });

  it("lève une erreur explicite si positionnée en production — jamais un dérouté silencieux vers Moneroo", () => {
    process.env.DJOMY_STUB_SIMULATED_DELAY_MS = "15000";
    process.env.NODE_ENV = "production";

    expect(() => resolveDjomyStubDelayMs()).toThrow(/production/);
  });
});
