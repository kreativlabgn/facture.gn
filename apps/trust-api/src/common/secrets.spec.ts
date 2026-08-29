import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSecretsValid, validateSecrets, type SecretSpec } from "./secrets";

const HEX64 = "0123456789abcdef".repeat(4);
const HEX64_B = "fedcba9876543210".repeat(4);
const PEM = "-----BEGIN TEST KEY-----\nMIIabcTESTONLY\n-----END TEST KEY-----\n";

const SPECS: readonly SecretSpec[] = [
  { name: "DB", required: true, requiredInProduction: true, format: "postgresUrl", purpose: "base" },
  { name: "KEY", required: true, requiredInProduction: true, format: "hex64", purpose: "clé" },
  { name: "PROD_ONLY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "prod" },
  { name: "PEM_KEY", required: true, requiredInProduction: true, format: "pem", purpose: "pem" },
];

const validEnv = (): NodeJS.ProcessEnv =>
  ({
    DB: "postgresql://u:p@localhost:5432/db",
    KEY: HEX64_B,
    PROD_ONLY: HEX64,
    PEM_KEY: PEM,
  }) as NodeJS.ProcessEnv;

afterEach(() => vi.restoreAllMocks());

describe("validateSecrets", () => {
  it("ne retourne aucun problème pour un environnement complet et bien formé", () => {
    expect(validateSecrets(validEnv(), SPECS, { production: true })).toEqual([]);
  });

  it("signale un secret requis manquant", () => {
    const env = validEnv();
    delete env.KEY;
    const problems = validateSecrets(env, SPECS, { production: false });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("KEY manquant");
  });

  it("n'exige un secret requiredInProduction qu'en production", () => {
    const env = validEnv();
    delete env.PROD_ONLY;
    expect(validateSecrets(env, SPECS, { production: false })).toEqual([]);
    expect(validateSecrets(env, SPECS, { production: true })).toEqual([
      expect.stringContaining("PROD_ONLY manquant"),
    ]);
  });

  it("rejette une valeur de gabarit en production, l'avertit seulement en dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = validEnv();
    // gabarit .env.example, format hexMin32 par ailleurs valide
    env.PROD_ONLY = "0".repeat(40);

    expect(validateSecrets(env, SPECS, { production: true })).toEqual([
      expect.stringContaining("PROD_ONLY a une valeur de gabarit"),
    ]);

    expect(validateSecrets(env, SPECS, { production: false })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PROD_ONLY a une valeur de gabarit"));
  });

  it("détecte le gabarit littéral 'EXAMPLE0000…' de .env.example", () => {
    const env = validEnv();
    env.PROD_ONLY = "example000000000000000000";
    const problems = validateSecrets(env, SPECS, { production: true });
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("PROD_ONLY a une valeur de gabarit")]));
  });

  it("signale un mauvais format", () => {
    const env = validEnv();
    env.DB = "mysql://nope";
    env.KEY = "trop-court";
    env.PEM_KEY = "pas du pem";
    const problems = validateSecrets(env, SPECS, { production: false });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DB au mauvais format"),
        expect.stringContaining("KEY au mauvais format"),
        expect.stringContaining("PEM_KEY au mauvais format"),
      ]),
    );
  });

  it("agrège plusieurs problèmes", () => {
    const problems = validateSecrets({} as NodeJS.ProcessEnv, SPECS, { production: true });
    expect(problems.length).toBe(4);
  });
});

describe("assertSecretsValid", () => {
  it("ne lève pas quand tout est valide", () => {
    expect(() => assertSecretsValid(validEnv(), SPECS, { production: true })).not.toThrow();
  });

  it("lève une erreur listant tous les problèmes et pointant vers le runbook", () => {
    let caught: Error | undefined;
    try {
      assertSecretsValid({ DB: "postgresql://ok@h/d" } as NodeJS.ProcessEnv, SPECS, { production: true });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain("Configuration des secrets invalide (3)");
    expect(caught?.message).toContain("KEY manquant");
    expect(caught?.message).toContain("PROD_ONLY manquant");
    expect(caught?.message).toContain("docs/runbooks/secrets-management.md");
  });
});
