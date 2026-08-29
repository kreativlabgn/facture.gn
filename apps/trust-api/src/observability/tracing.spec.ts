import { afterEach, describe, expect, it } from "vitest";

import { startTracing, stopTracing } from "./tracing";

const OTEL_KEYS = [
  "OTEL_TRACES_ENABLED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
];

describe("startTracing", () => {
  afterEach(async () => {
    for (const key of OTEL_KEYS) delete process.env[key];
    await stopTracing();
  });

  it("retourne null quand les traces sont désactivées (défaut)", () => {
    expect(startTracing("trust-api")).toBeNull();
  });

  it("ne lève pas et retourne null même si le flag est mis mais sans endpoint", () => {
    process.env.OTEL_TRACES_ENABLED = "true";
    expect(() => startTracing("trust-api")).not.toThrow();
    expect(startTracing("trust-api")).toBeNull();
  });
});
