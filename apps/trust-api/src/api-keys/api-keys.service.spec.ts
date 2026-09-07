import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiKeysService } from "./api-keys.service";

// organizationScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes inchangées.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}

function createFakePasswordService() {
  return {
    hash: vi.fn().mockImplementation((plain: string) => Promise.resolve(`hashed(${plain})`)),
    verify: vi.fn(),
    generateTemporaryPassword: vi.fn(),
  };
}

function createFakePrisma(overrides: { apiKeys?: any[]; existingApiKey?: any } = {}) {
  const cleParDefaut = { id: "apikey-1", organizationId: "org-1", revokedAt: null };
  // `in` plutôt que `??` : un test doit pouvoir demander explicitement
  // l'ABSENCE de clé (existingApiKey: null), que `??` écraserait par le défaut.
  const cle = "existingApiKey" in overrides ? overrides.existingApiKey : cleParDefaut;

  return auClientScope({
    apiKey: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: "apikey-1", createdAt: new Date("2026-08-18T00:00:00.000Z"), revokedAt: null, lastUsedAt: null, ...data }),
      ),
      findMany: vi.fn().mockResolvedValue(overrides.apiKeys ?? []),
      // Applique RÉELLEMENT le filtrage décrit par le `where` : c'est ce qui
      // permet au test d'IDOR de prouver quelque chose. Un mock figé renverrait
      // la clé d'une autre organisation et laisserait passer une régression.
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (!cle) return Promise.resolve(null);
        if (where.organizationId && cle.organizationId !== where.organizationId) {
          return Promise.resolve(null);
        }
        if (where.id && cle.id !== where.id) return Promise.resolve(null);
        return Promise.resolve(cle);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
  });
}

describe("ApiKeysService.createApiKey (F15, ADR-097)", () => {
  it("retourne le secret complet en clair, jamais stocké tel quel", async () => {
    const prisma = createFakePrisma();
    const passwordService = createFakePasswordService();
    const service = new ApiKeysService(prisma as any, passwordService as any);

    const result = await service.createApiKey("org-1", "production", "user-1");

    expect(result.secret.startsWith("fg_live_")).toBe(true);
    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        environment: "production",
        keyHash: `hashed(${result.secret})`,
        createdByUserId: "user-1",
      }),
    });
    // Le hash stocké n'est jamais égal au secret en clair.
    const createCall = prisma.apiKey.create.mock.calls[0][0];
    expect(createCall.data.keyHash).not.toBe(result.secret);
  });

  it("stocke keySuffix cohérent avec le secret généré", async () => {
    const prisma = createFakePrisma();
    const passwordService = createFakePasswordService();
    const service = new ApiKeysService(prisma as any, passwordService as any);

    const result = await service.createApiKey("org-1", "sandbox", "user-1");

    expect(result.secret.endsWith(result.secret.slice(-4))).toBe(true);
    const createCall = prisma.apiKey.create.mock.calls[0][0];
    expect(createCall.data.keySuffix).toBe(result.secret.slice(-4));
  });
});

describe("ApiKeysService.listApiKeys (F15, ADR-097)", () => {
  it("ne retourne jamais keyHash, seulement un label masqué", async () => {
    const prisma = createFakePrisma({
      apiKeys: [
        {
          id: "apikey-1",
          organizationId: "org-1",
          environment: "production",
          keyHash: "hashed(secret-reel)",
          keySuffix: "9f2a",
          createdAt: new Date("2026-08-18T00:00:00.000Z"),
          revokedAt: null,
          lastUsedAt: null,
        },
      ],
    });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    const result = await service.listApiKeys("org-1");

    expect(result[0]).not.toHaveProperty("keyHash");
    expect(result[0].label).toBe("fg_live_••••9f2a");
  });

  it("exclut les clés révoquées de la liste", async () => {
    const prisma = createFakePrisma();
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await service.listApiKeys("org-1");

    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", revokedAt: null } }),
    );
  });
});

describe("ApiKeysService.revokeApiKey (F15, ADR-097)", () => {
  it("pose revokedAt sur une clé appartenant à l'organisation ciblée", async () => {
    const prisma = createFakePrisma({
      existingApiKey: { id: "apikey-1", organizationId: "org-1", revokedAt: null },
    });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await service.revokeApiKey("org-1", "apikey-1", "user-2");

    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: "apikey-1" },
      data: { revokedAt: expect.any(Date), revokedByUserId: "user-2" },
    });
  });

  it("rejette (NotFoundException) une clé appartenant à une AUTRE organisation — jamais un 200 silencieux (IDOR)", async () => {
    const prisma = createFakePrisma({
      existingApiKey: { id: "apikey-1", organizationId: "org-victime", revokedAt: null },
    });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await expect(service.revokeApiKey("org-attaquant", "apikey-1", "user-2")).rejects.toThrow(/introuvable/);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  // Régression : avant la migration RLS, ce chemin passait par
  // findUniqueOrThrow, dont la NotFoundError Prisma n'était interceptée par aucun
  // ExceptionFilter (il n'y en a aucun dans cette application) — l'appelant
  // recevait un 500 là où le commentaire du service annonçait un 404 « générique
  // dans les deux cas ». La réponse est désormais réellement indistinguable de
  // celle d'une clé appartenant à une autre organisation.
  it("rejette (NotFoundException) une clé inexistante — même réponse qu'une clé d'une autre organisation", async () => {
    const prisma = createFakePrisma({ existingApiKey: null });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await expect(service.revokeApiKey("org-1", "apikey-inconnue", "user-2")).rejects.toThrow(NotFoundException);
    await expect(service.revokeApiKey("org-1", "apikey-inconnue", "user-2")).rejects.toThrow(/introuvable/);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) une clé déjà révoquée", async () => {
    const prisma = createFakePrisma({
      existingApiKey: { id: "apikey-1", organizationId: "org-1", revokedAt: new Date("2026-08-17T00:00:00.000Z") },
    });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await expect(service.revokeApiKey("org-1", "apikey-1", "user-2")).rejects.toThrow(/déjà révoquée/);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });
});
