import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";
import { PRISMA_CLIENT } from "./common/prisma.module";

// Smoke test du graphe DI complet de money-api (BullMQ inclus). La connexion
// Redis est en lazyConnect (queue.config) : compile sans qu'un Redis tourne.
// Même garde que apps/trust-api/src/app.module.spec.ts — ne jamais supprimer.
describe("AppModule (money-api) — graphe de dépendances", () => {
  const TEST_ENV: Record<string, string> = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/x?schema=public",
    MONEY_API_INTERNAL_KEY: "a".repeat(64),
    TRUST_API_URL: "http://localhost:3000",
    // Le worker de réconciliation ne s'arme pas pendant le smoke (onModuleInit
    // n'est de toute façon pas appelé par .compile(), ceinture + bretelles).
    RECONCILIATION_ENABLED: "false",
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

  it("se compile entièrement (tous les providers résolvables, BullMQ inclus)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PRISMA_CLIENT)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
