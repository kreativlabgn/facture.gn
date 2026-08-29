import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";
import { PRISMA_CLIENT } from "./common/prisma.module";

// Smoke test du graphe de dépendances complet — compile l'AppModule entier.
// Découvre les câblages DI cassés (provider non exporté d'un module @Global,
// import manquant) que ni vitest unitaire ni tsc ne voient. C'est le "test de
// démarrage" recommandé par le benchmark (dimension B — aucun e2e/bootstrap).
describe("AppModule — graphe de dépendances", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Les modules qui lisent des secrets au démarrage (fail-fast) ont besoin de
    // valeurs présentes ; jamais de vraies clés — 64 hex factices.
    const fakeSecret = "a".repeat(64);
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/x?schema=public",
      JWT_PRIVATE_KEY: "x",
      JWT_PUBLIC_KEY: "x",
      CERTIFICATION_PRIVATE_KEY: fakeSecret,
      CERTIFICATION_MASTER_KEY: fakeSecret,
      MONEY_API_URL: "http://localhost:3001",
      MONEY_API_INTERNAL_KEY: fakeSecret,
      DGI_VERIFICATION_INTERNAL_KEY: fakeSecret,
      COMMERCIAL_AGENT_GRANT_INTERNAL_KEY: fakeSecret,
      COMMISSION_BYPASS_REVIEW_INTERNAL_KEY: fakeSecret,
      APIP_WEBHOOK_SECRET: fakeSecret,
    });
  });

  afterAll(() => {
    process.env = originalEnv;
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
