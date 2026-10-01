import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSecretsValid, TRUST_API_SECRETS, validateSecrets, type SecretSpec } from "./secrets";

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

// Plan 2026-09-16 (OCR multicanal), étape 3 — REDIS_URL (oubli corrigé) et
// l'inventaire de ce lot (OCR_STT_*, WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID,
// STORAGE_*). Ne réexerce pas assertSecretsValid()/validateSecrets() eux-mêmes
// (déjà couverts ci-dessus par un SPECS générique) — vérifie que
// TRUST_API_SECRETS, la VRAIE table utilisée par main.ts, porte les bonnes
// entrées avec le bon format et le bon niveau d'exigence.
describe("TRUST_API_SECRETS — inventaire, aucun doublon", () => {
  it("aucun nom de secret n'apparaît deux fois", () => {
    const noms = TRUST_API_SECRETS.map((s) => s.name);
    expect(new Set(noms).size).toBe(noms.length);
  });
});

describe("TRUST_API_SECRETS — plan 2026-09-16 (OCR multicanal), étape 3 + REDIS_URL", () => {
  const NOUVELLES_ENTREES = [
    "REDIS_URL",
    "OCR_STT_ENDPOINT",
    "OCR_STT_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "STORAGE_ENDPOINT",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "STORAGE_BUCKET",
  ] as const;

  it("chaque entrée neuve figure exactement une fois dans l'inventaire", () => {
    for (const nom of NOUVELLES_ENTREES) {
      expect(TRUST_API_SECRETS.filter((s) => s.name === nom)).toHaveLength(1);
    }
  });

  it("accepte des valeurs bien formées pour chacune, en production", () => {
    const env = {
      REDIS_URL: "redis://localhost:6379",
      OCR_STT_ENDPOINT: "https://stt.facture.gn",
      // Valeur factice (« deadbeef » ×4 : 32 hexadécimaux, entropie basse). Une
      // valeur aléatoire déclenchait la règle generic-api-key de gitleaks ; un seul
      // caractère répété (32 zéros) est refusé par REPEATED_CHAR (gabarit).
      OCR_STT_TOKEN: "deadbeefdeadbeefdeadbeefdeadbeef",
      WHATSAPP_ACCESS_TOKEN: "jeton-meta-quelconque",
      WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      STORAGE_ENDPOINT: "http://minio:9000",
      STORAGE_ACCESS_KEY: "minio-access",
      STORAGE_SECRET_KEY: "minio-secret",
      STORAGE_BUCKET: "ocr-media",
    } as NodeJS.ProcessEnv;

    const specs = TRUST_API_SECRETS.filter((s) => (NOUVELLES_ENTREES as readonly string[]).includes(s.name));
    expect(validateSecrets(env, specs, { production: true })).toEqual([]);
  });

  it("REDIS_URL — requiredInProduction: true (oubli corrigé : trust-api dépend de Redis pour BullMQ — retention, merkle-anchor, pdp, ocr-pipeline)", () => {
    const spec = TRUST_API_SECRETS.find((s) => s.name === "REDIS_URL");
    expect(spec).toMatchObject({ required: false, requiredInProduction: true, format: "redisUrl" });
  });

  it.each(["OCR_STT_ENDPOINT", "OCR_STT_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "STORAGE_ENDPOINT", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "STORAGE_BUCKET"])(
    "%s — jamais requiredInProduction (dégradation prévisible et limitée à sa branche, jamais un refus de démarrage de trust-api)",
    (nom) => {
      const spec = TRUST_API_SECRETS.find((s) => s.name === nom);
      expect(spec?.requiredInProduction).toBe(false);
    },
  );

  it("signale un format invalide pour REDIS_URL (ex. postgres:// au lieu de redis://)", () => {
    const specs = TRUST_API_SECRETS.filter((s) => s.name === "REDIS_URL");
    const problems = validateSecrets({ REDIS_URL: "postgres://nope" } as NodeJS.ProcessEnv, specs, { production: true });
    expect(problems).toEqual([expect.stringContaining("REDIS_URL au mauvais format")]);
  });

  it("signale un format invalide pour OCR_STT_TOKEN (moins de 32 caractères hexadécimaux)", () => {
    const specs = TRUST_API_SECRETS.filter((s) => s.name === "OCR_STT_TOKEN");
    const problems = validateSecrets({ OCR_STT_TOKEN: "trop-court" } as NodeJS.ProcessEnv, specs, { production: true });
    expect(problems).toEqual([expect.stringContaining("OCR_STT_TOKEN au mauvais format")]);
  });
});
