import { describe, expect, it, vi } from "vitest";
import { ApiKeysService } from "./api-keys.service";

function createFakePasswordService() {
  return {
    hash: vi.fn().mockImplementation((plain: string) => Promise.resolve(`hashed(${plain})`)),
    verify: vi.fn(),
    generateTemporaryPassword: vi.fn(),
  };
}

function createFakePrisma(overrides: { apiKeys?: any[]; existingApiKey?: any } = {}) {
  return {
    apiKey: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: "apikey-1", createdAt: new Date("2026-08-18T00:00:00.000Z"), revokedAt: null, lastUsedAt: null, ...data }),
      ),
      findMany: vi.fn().mockResolvedValue(overrides.apiKeys ?? []),
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        overrides.existingApiKey ?? {
          id: "apikey-1",
          organizationId: "org-1",
          revokedAt: null,
        },
      ),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
  };
}

describe("ApiKeysService.createApiKey (F15, ADR-097)", () => {
  it("retourne le secret complet en clair, jamais stocké tel quel", async () => {
    const prisma = createFakePrisma();
    const passwordService = createFakePasswordService();
    const service = new ApiKeysService(prisma as any, passwordService as any);

    const result = await service.createApiKey("org-1", "production");

    expect(result.secret.startsWith("fg_live_")).toBe(true);
    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        environment: "production",
        keyHash: `hashed(${result.secret})`,
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

    const result = await service.createApiKey("org-1", "sandbox");

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

    await service.revokeApiKey("org-1", "apikey-1");

    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: "apikey-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("rejette (NotFoundException) une clé appartenant à une AUTRE organisation — jamais un 200 silencieux (IDOR)", async () => {
    const prisma = createFakePrisma({
      existingApiKey: { id: "apikey-1", organizationId: "org-victime", revokedAt: null },
    });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await expect(service.revokeApiKey("org-attaquant", "apikey-1")).rejects.toThrow(/introuvable/);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) une clé déjà révoquée", async () => {
    const prisma = createFakePrisma({
      existingApiKey: { id: "apikey-1", organizationId: "org-1", revokedAt: new Date("2026-08-17T00:00:00.000Z") },
    });
    const service = new ApiKeysService(prisma as any, createFakePasswordService() as any);

    await expect(service.revokeApiKey("org-1", "apikey-1")).rejects.toThrow(/déjà révoquée/);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });
});
