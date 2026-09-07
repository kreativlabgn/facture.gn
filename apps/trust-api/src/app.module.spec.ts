import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";
import { PRISMA_CLIENT } from "./common/prisma.module";

// Smoke test du graphe de dépendances complet — compile l'AppModule entier.
// Découvre les câblages DI cassés (provider non exporté d'un module @Global,
// import manquant) que ni vitest unitaire ni tsc ne voient. C'est le "test de
// démarrage" recommandé par le benchmark (dimension B — aucun e2e/bootstrap).
describe("AppModule — graphe de dépendances", () => {
  // Les modules qui lisent des secrets au démarrage (fail-fast) ont besoin de
  // valeurs présentes ; jamais de vraies clés — 64 hex factices.
  const TEST_ENV: Record<string, string> = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/x?schema=public",
    JWT_PRIVATE_KEY: "x",
    JWT_PUBLIC_KEY: "x",
    CERTIFICATION_PRIVATE_KEY: "a".repeat(64),
    CERTIFICATION_MASTER_KEY: "a".repeat(64),
    MONEY_API_URL: "http://localhost:3001",
    MONEY_API_INTERNAL_KEY: "a".repeat(64),
    DGI_VERIFICATION_INTERNAL_KEY: "a".repeat(64),
    COMMERCIAL_AGENT_GRANT_INTERNAL_KEY: "a".repeat(64),
    COMMISSION_BYPASS_REVIEW_INTERNAL_KEY: "a".repeat(64),
    DATA_RIGHTS_INTERNAL_KEY: "a".repeat(64),
    CREDITS_INTERNAL_KEY: "a".repeat(64),
    DATA_RIGHTS_SUBJECT_HASH_PEPPER: "a".repeat(64),
    APIP_WEBHOOK_SECRET: "a".repeat(64),
    // Lot J3 — le job de rétention ne s'arme pas pendant le smoke (onModuleInit
    // n'est de toute façon pas appelé par .compile(), ceinture + bretelles).
    RETENTION_ENABLED: "false",
    MERKLE_ANCHOR_ENABLED: "false",
  };
  const saved = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, previous] of saved) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("se compile entièrement (tous les providers résolvables)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Prisma : jamais de vraie connexion en test unitaire.
      .overrideProvider(PRISMA_CLIENT)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
