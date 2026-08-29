import { describe, expect, it } from "vitest";

import { buildTracingConfig, parseOtlpHeaders } from "./tracing-config";

const BASE_ENV = {} as NodeJS.ProcessEnv;

describe("buildTracingConfig", () => {
  it("désactive les traces si OTEL_TRACES_ENABLED n'est pas 'true'", () => {
    const config = buildTracingConfig(
      { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" } as NodeJS.ProcessEnv,
      "money-api",
    );
    expect(config.enabled).toBe(false);
  });

  it("désactive les traces si aucun endpoint OTLP n'est fourni", () => {
    const config = buildTracingConfig({ OTEL_TRACES_ENABLED: "true" } as NodeJS.ProcessEnv, "money-api");
    expect(config.enabled).toBe(false);
  });

  it("active les traces quand le flag ET l'endpoint générique sont présents", () => {
    const config = buildTracingConfig(
      { OTEL_TRACES_ENABLED: "true", OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" } as NodeJS.ProcessEnv,
      "money-api",
    );
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe("http://collector:4318/v1/traces");
    expect(config.serviceName).toBe("money-api");
    expect(config.serviceVersion).toBe("0.0.0");
  });

  it("préfère l'endpoint spécifique aux traces et ne lui ajoute pas /v1/traces", () => {
    const config = buildTracingConfig(
      {
        OTEL_TRACES_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/custom/traces",
      } as NodeJS.ProcessEnv,
      "money-api",
    );
    expect(config.endpoint).toBe("http://collector:4318/custom/traces");
  });

  it("supprime les slashs finaux de l'endpoint générique avant d'ajouter le path", () => {
    const config = buildTracingConfig(
      { OTEL_TRACES_ENABLED: "true", OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318///" } as NodeJS.ProcessEnv,
      "money-api",
    );
    expect(config.endpoint).toBe("http://collector:4318/v1/traces");
  });

  it("laisse surcharger le nom et la version de service par l'environnement", () => {
    const config = buildTracingConfig(
      {
        OTEL_TRACES_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318",
        OTEL_SERVICE_NAME: "money-api-canary",
        OTEL_SERVICE_VERSION: "1.4.2",
      } as NodeJS.ProcessEnv,
      "money-api",
    );
    expect(config.serviceName).toBe("money-api-canary");
    expect(config.serviceVersion).toBe("1.4.2");
  });

  it("borne le ratio de sampling à [0, 1] et retombe sur 1 si non numérique", () => {
    const mk = (arg: string) =>
      buildTracingConfig(
        {
          OTEL_TRACES_ENABLED: "true",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318",
          OTEL_TRACES_SAMPLER_ARG: arg,
        } as NodeJS.ProcessEnv,
        "money-api",
      ).samplerRatio;
    expect(mk("0.1")).toBe(0.1);
    expect(mk("5")).toBe(1);
    expect(mk("-2")).toBe(0);
    expect(mk("abc")).toBe(1);
    expect(buildTracingConfig(BASE_ENV, "money-api").samplerRatio).toBe(1);
  });
});

describe("parseOtlpHeaders", () => {
  it("retourne undefined pour une valeur vide", () => {
    expect(parseOtlpHeaders(undefined)).toBeUndefined();
    expect(parseOtlpHeaders("")).toBeUndefined();
  });

  it("parse une liste 'clé=valeur' séparée par des virgules", () => {
    expect(parseOtlpHeaders("x-api-key=abc123,tenant=guinee")).toEqual({
      "x-api-key": "abc123",
      tenant: "guinee",
    });
  });

  it("ignore les entrées sans '=' plutôt que de produire une clé vide", () => {
    expect(parseOtlpHeaders("garbage,x-api-key=ok")).toEqual({ "x-api-key": "ok" });
  });

  it("conserve les '=' dans la valeur (ex. base64)", () => {
    expect(parseOtlpHeaders("auth=dXNlcjpwYXNz==")).toEqual({ auth: "dXNlcjpwYXNz==" });
  });
});
