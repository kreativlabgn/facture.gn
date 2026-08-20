import { ConflictException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationSigningKeyService } from "./organization-signing-key.service";

const MASTER_KEY_HEX = "a".repeat(64);

function createFakePrisma(overrides: { signingKey?: any } = {}) {
  const prisma: any = {
    organizationSigningKey: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "key-1", ...data })),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "key-1", ...data })),
      ...overrides.signingKey,
    },
  };
  return prisma;
}

describe("OrganizationSigningKeyService", () => {
  const originalEnv = process.env.CERTIFICATION_MASTER_KEY;

  beforeEach(() => {
    process.env.CERTIFICATION_MASTER_KEY = MASTER_KEY_HEX;
  });

  afterEach(() => {
    process.env.CERTIFICATION_MASTER_KEY = originalEnv;
  });

  it("échoue au démarrage si CERTIFICATION_MASTER_KEY n'est pas configuré", () => {
    delete process.env.CERTIFICATION_MASTER_KEY;
    const prisma = createFakePrisma();

    expect(() => new OrganizationSigningKeyService(prisma as any)).toThrow(/CERTIFICATION_MASTER_KEY/);
  });

  describe("provisionRootKey", () => {
    it("génère une paire de clés Ed25519 et persiste la clé privée chiffrée, jamais en clair", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);

      const result = await service.provisionRootKey("org-1");

      expect(prisma.organizationSigningKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: "org-1",
            publicKey: expect.any(String),
            encryptedPrivateKey: expect.any(String),
          }),
        }),
      );
      const createCall = prisma.organizationSigningKey.create.mock.calls[0][0];
      expect(createCall.data.encryptedPrivateKey).not.toMatch(/^[0-9a-f]{64}$/); // pas une clé brute de 32 octets en hex
      expect(result.id).toBe("key-1");
      expect(result.publicKey).toBe(createCall.data.publicKey);
    });

    it("utilise le client de transaction fourni plutôt que this.prisma quand tx est passé", async () => {
      const prisma = createFakePrisma();
      const tx: any = { organizationSigningKey: { create: vi.fn().mockResolvedValue({ id: "key-tx" }) } };
      const service = new OrganizationSigningKeyService(prisma as any);

      const result = await service.provisionRootKey("org-1", tx);

      expect(tx.organizationSigningKey.create).toHaveBeenCalled();
      expect(prisma.organizationSigningKey.create).not.toHaveBeenCalled();
      expect(result.id).toBe("key-tx");
    });
  });

  describe("certifyForOrganization / verifyWithKey", () => {
    it("certifyForOrganization signe avec la clé déchiffrée de l'organisation, puis verifyWithKey confirme la même signature", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);
      const provisioned = await service.provisionRootKey("org-1");

      const storedKey = prisma.organizationSigningKey.create.mock.calls[0][0].data;
      prisma.organizationSigningKey.findUniqueOrThrow.mockImplementation(({ where }: any) => {
        if (where.organizationId === "org-1" || where.id === provisioned.id) {
          return Promise.resolve({ id: provisioned.id, ...storedKey });
        }
        throw new Error("introuvable");
      });

      const payload = {
        invoiceId: "inv-1",
        organizationNif: "GN12345678",
        number: "FG-2026-000001",
        totalTtc: 1_500_000n,
        issuedAt: "2026-08-10T10:00:00.000Z",
        previousHash: "GENESIS",
      };

      const certified = await service.certifyForOrganization("org-1", payload);
      expect(certified.signingKeyId).toBe(provisioned.id);

      const reverified = await service.verifyWithKey(provisioned.id, payload);
      expect(reverified.signature).toBe(certified.signature);
      expect(reverified.hash).toBe(certified.hash);
    });

    it("certifyForOrganization refuse (erreur explicite) si l'organisation n'a aucune clé provisionnée", async () => {
      const prisma = createFakePrisma({
        signingKey: { findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("introuvable")) },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      await expect(
        service.certifyForOrganization("org-sans-cle", {
          invoiceId: "inv-1",
          organizationNif: "GN12345678",
          number: "FG-2026-000001",
          totalTtc: 1_500_000n,
          issuedAt: "2026-08-10T10:00:00.000Z",
          previousHash: "GENESIS",
        }),
      ).rejects.toThrow();
    });

    it("certifyForOrganization refuse (ConflictException) de signer avec une clé révoquée (A4, ADR-025)", async () => {
      const prisma = createFakePrisma({
        signingKey: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: "key-1",
            organizationId: "org-1",
            encryptedPrivateKey: "peu-importe",
            revokedAt: new Date("2026-08-15T00:00:00.000Z"),
          }),
        },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      await expect(
        service.certifyForOrganization("org-1", {
          invoiceId: "inv-1",
          organizationNif: "GN12345678",
          number: "FG-2026-000001",
          totalTtc: 1_500_000n,
          issuedAt: "2026-08-20T10:00:00.000Z",
          previousHash: "GENESIS",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("revoke (A4, ADR-025)", () => {
    it("pose revokedAt sur la clé de l'organisation", async () => {
      const prisma = createFakePrisma({
        signingKey: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ id: "key-1", organizationId: "org-1", revokedAt: null }),
        },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      const before = Date.now();
      const result = await service.revoke("org-1");

      expect(prisma.organizationSigningKey.update).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.revokedAt).not.toBeNull();
      expect(result.revokedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("est idempotent — un second appel sur une clé déjà révoquée ne réécrit pas revokedAt", async () => {
      const alreadyRevokedAt = new Date("2026-08-15T00:00:00.000Z");
      const prisma = createFakePrisma({
        signingKey: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ id: "key-1", organizationId: "org-1", revokedAt: alreadyRevokedAt }),
        },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      const result = await service.revoke("org-1");

      expect(prisma.organizationSigningKey.update).not.toHaveBeenCalled();
      expect(result.revokedAt).toBe(alreadyRevokedAt);
    });
  });
});
