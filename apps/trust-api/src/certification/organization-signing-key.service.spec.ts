import { ConflictException, NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationSigningKeyService } from "./organization-signing-key.service";

const MASTER_KEY_HEX = "a".repeat(64);

function createFakePrisma(overrides: { signingKey?: any } = {}) {
  const prisma: any = {
    organizationSigningKey: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `key-${Math.random()}`, ...data })),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      ...overrides.signingKey,
    },
  };
  prisma.$transaction = vi.fn((cb: any) => cb(prisma));
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
    expect(() => new OrganizationSigningKeyService(createFakePrisma() as any)).toThrow(/CERTIFICATION_MASTER_KEY/);
  });

  describe("provisionRootKey", () => {
    it("génère une paire Ed25519 et persiste la clé privée chiffrée, jamais en clair", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);

      const result = await service.provisionRootKey("org-1");

      const createCall = prisma.organizationSigningKey.create.mock.calls[0][0];
      expect(createCall.data).toMatchObject({ organizationId: "org-1" });
      expect(createCall.data.encryptedPrivateKey).not.toMatch(/^[0-9a-f]{64}$/);
      expect(result.publicKey).toBe(createCall.data.publicKey);
    });

    it("utilise le client de transaction fourni quand tx est passé", async () => {
      const prisma = createFakePrisma();
      const tx: any = { organizationSigningKey: { create: vi.fn().mockResolvedValue({ id: "key-tx" }) } };
      const service = new OrganizationSigningKeyService(prisma as any);

      await service.provisionRootKey("org-1", tx);

      expect(tx.organizationSigningKey.create).toHaveBeenCalled();
      expect(prisma.organizationSigningKey.create).not.toHaveBeenCalled();
    });
  });

  describe("certifyForOrganization / verifyWithKey", () => {
    it("signe avec la clé ACTIVE puis verifyWithKey confirme la même signature", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);
      const provisioned = await service.provisionRootKey("org-1");
      const storedKey = prisma.organizationSigningKey.create.mock.calls[0][0].data;

      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: provisioned.id,
        organizationId: "org-1",
        retiredAt: null,
        revokedAt: null,
        ...storedKey,
      });
      prisma.organizationSigningKey.findUniqueOrThrow.mockResolvedValue({
        id: provisioned.id,
        retiredAt: null,
        revokedAt: null,
        ...storedKey,
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
      // la requête cible la clé active (retiredAt: null), pas "la" clé de l'org
      expect(prisma.organizationSigningKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org-1", retiredAt: null } }),
      );

      const reverified = await service.verifyWithKey(provisioned.id, payload);
      expect(reverified.signature).toBe(certified.signature);
    });

    it("refuse (ConflictException) si l'organisation n'a AUCUNE clé active (toutes retirées/révoquées)", async () => {
      const prisma = createFakePrisma({ signingKey: { findFirst: vi.fn().mockResolvedValue(null) } });
      const service = new OrganizationSigningKeyService(prisma as any);

      await expect(
        service.certifyForOrganization("org-1", {
          invoiceId: "inv-1",
          organizationNif: "GN12345678",
          number: "FG-2026-000001",
          totalTtc: 1_500_000n,
          issuedAt: "2026-08-10T10:00:00.000Z",
          previousHash: "GENESIS",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("refuse (ConflictException) de signer avec une clé active mais révoquée (A4, ADR-025)", async () => {
      const prisma = createFakePrisma({
        signingKey: {
          findFirst: vi.fn().mockResolvedValue({
            id: "key-1",
            organizationId: "org-1",
            encryptedPrivateKey: "peu-importe",
            retiredAt: null,
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

    it("verifyWithKey : une facture signée par une clé désormais RETIRÉE reste vérifiable (retrait ≠ révocation)", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);
      const provisioned = await service.provisionRootKey("org-1");
      const storedKey = prisma.organizationSigningKey.create.mock.calls[0][0].data;

      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: provisioned.id,
        organizationId: "org-1",
        retiredAt: null,
        revokedAt: null,
        ...storedKey,
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

      // la clé est ensuite retirée par une rotation
      prisma.organizationSigningKey.findUniqueOrThrow.mockResolvedValue({
        id: provisioned.id,
        retiredAt: new Date("2026-09-01T00:00:00.000Z"),
        revokedAt: null,
        ...storedKey,
      });

      const reverified = await service.verifyWithKey(provisioned.id, payload);
      expect(reverified.signature).toBe(certified.signature);
      expect(reverified.revokedAt).toBeNull();
    });
  });

  describe("rotate (E3, ADR-114)", () => {
    it("retire la clé active et en provisionne une nouvelle (publicKey différent)", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);
      const first = await service.provisionRootKey("org-1");
      prisma.organizationSigningKey.create.mockClear();
      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: first.id,
        organizationId: "org-1",
        retiredAt: null,
        revokedAt: null,
      });

      const rotated = await service.rotate("org-1");

      expect(prisma.organizationSigningKey.update).toHaveBeenCalledWith({
        where: { id: first.id },
        data: { retiredAt: expect.any(Date) },
      });
      expect(prisma.organizationSigningKey.create).toHaveBeenCalledTimes(1);
      expect(rotated.publicKey).not.toBe(first.publicKey);
      expect((rotated as any).encryptedPrivateKey).toBeUndefined();
    });

    it("retire INCONDITIONNELLEMENT la clé courante, même déjà révoquée (pas de 2e ligne retiredAt: null)", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);
      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: "key-revoked",
        organizationId: "org-1",
        retiredAt: null,
        revokedAt: new Date("2026-08-15T00:00:00.000Z"),
      });

      await service.rotate("org-1");

      expect(prisma.organizationSigningKey.update).toHaveBeenCalledWith({
        where: { id: "key-revoked" },
        data: { retiredAt: expect.any(Date) },
      });
      expect(prisma.organizationSigningKey.create).toHaveBeenCalledTimes(1);
    });

    it("après revoke → rotate → revoke : la 2e révocation cible la NOUVELLE clé, pas l'ancienne", async () => {
      // Faux Prisma stateful : une seule ligne "courante" (retiredAt: null) à la fois.
      const rows: any[] = [{ id: "A", organizationId: "org-1", createdAt: new Date(1), retiredAt: null, revokedAt: null }];
      const prisma: any = {
        organizationSigningKey: {
          findFirst: vi.fn(({ where }: any) =>
            Promise.resolve(
              rows
                .filter((r) => r.organizationId === where.organizationId && (where.retiredAt === null ? r.retiredAt === null : true))
                .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
            ),
          ),
          count: vi.fn(() => Promise.resolve(rows.filter((r) => r.retiredAt !== null).length)),
          update: vi.fn(({ where, data }: any) => {
            const row = rows.find((r) => r.id === where.id);
            Object.assign(row, data);
            return Promise.resolve(row);
          }),
          create: vi.fn(({ data }: any) => {
            const row = { id: `K${rows.length}`, createdAt: new Date(rows.length + 10), retiredAt: null, revokedAt: null, ...data };
            rows.push(row);
            return Promise.resolve(row);
          }),
        },
      };
      prisma.$transaction = (cb: any) => cb(prisma);
      const service = new OrganizationSigningKeyService(prisma as any);

      const r1 = await service.revoke("org-1");
      expect(r1.id).toBe("A");

      await service.rotate("org-1"); // A retirée, nouvelle clé K1 active
      const rowA = rows.find((r) => r.id === "A");
      expect(rowA.retiredAt).not.toBeNull();

      const r2 = await service.revoke("org-1");
      expect(r2.id).not.toBe("A"); // la nouvelle clé, pas l'ancienne révoquée
      expect(rows.filter((r) => r.retiredAt === null && r.revokedAt !== null)).toHaveLength(1);
      expect(rows.filter((r) => r.retiredAt === null && r.revokedAt === null)).toHaveLength(0);
    });

    it("course : deux rotate() concurrents → P2002 sur l'index partiel → ConflictException", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);
      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: "key-1",
        organizationId: "org-1",
        retiredAt: null,
        revokedAt: null,
      });
      prisma.organizationSigningKey.create.mockRejectedValueOnce(
        Object.assign(new Error("unique"), { code: "P2002" }),
      );

      await expect(service.rotate("org-1")).rejects.toThrow(ConflictException);
    });
  });

  describe("revoke (A4, ADR-025)", () => {
    it("pose revokedAt sur la clé courante (ciblée par id) et ne renvoie que des métadonnées publiques", async () => {
      const prisma = createFakePrisma({
        signingKey: {
          findFirst: vi.fn().mockResolvedValue({
            id: "key-1",
            organizationId: "org-1",
            publicKey: "pub",
            encryptedPrivateKey: "SECRET-CIPHERTEXT",
            retiredAt: null,
            revokedAt: null,
          }),
          update: vi.fn(({ where, data }: any) =>
            Promise.resolve({ id: where.id, publicKey: "pub", encryptedPrivateKey: "SECRET-CIPHERTEXT", ...data }),
          ),
        },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      const result = await service.revoke("org-1");

      expect(prisma.organizationSigningKey.update).toHaveBeenCalledWith({
        where: { id: "key-1" },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.revokedAt).not.toBeNull();
      expect((result as any).encryptedPrivateKey).toBeUndefined();
    });

    it("NotFoundException si l'organisation n'a aucune clé active", async () => {
      const prisma = createFakePrisma({ signingKey: { findFirst: vi.fn().mockResolvedValue(null) } });
      const service = new OrganizationSigningKeyService(prisma as any);

      await expect(service.revoke("org-1")).rejects.toThrow(NotFoundException);
    });

    it("idempotent — un second appel sur une clé déjà révoquée ne réécrit pas revokedAt", async () => {
      const alreadyRevokedAt = new Date("2026-08-15T00:00:00.000Z");
      const prisma = createFakePrisma({
        signingKey: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "key-1", organizationId: "org-1", retiredAt: null, revokedAt: alreadyRevokedAt }),
        },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      const result = await service.revoke("org-1");

      expect(prisma.organizationSigningKey.update).not.toHaveBeenCalled();
      expect(result.revokedAt).toBe(alreadyRevokedAt);
    });
  });

  describe("getKeyStatus (E3)", () => {
    it("rotationDue=false à J+0, true au-delà de 365 jours ; retiredKeyCount reporté", async () => {
      const prisma = createFakePrisma();
      const service = new OrganizationSigningKeyService(prisma as any);

      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: "key-1",
        organizationId: "org-1",
        publicKey: "pub",
        encryptedPrivateKey: "SECRET",
        createdAt: new Date(),
        retiredAt: null,
        revokedAt: null,
      });
      prisma.organizationSigningKey.count.mockResolvedValue(2);

      const fresh = await service.getKeyStatus("org-1");
      expect(fresh).toMatchObject({ active: true, rotationDue: false, retiredKeyCount: 2 });
      expect((fresh as any).encryptedPrivateKey).toBeUndefined();

      prisma.organizationSigningKey.findFirst.mockResolvedValue({
        id: "key-1",
        organizationId: "org-1",
        publicKey: "pub",
        createdAt: new Date(Date.now() - 365 * 24 * 3600_000 - 1),
        retiredAt: null,
        revokedAt: null,
      });
      const old = await service.getKeyStatus("org-1");
      expect(old).toMatchObject({ active: true, rotationDue: true });
    });

    it("active=false si l'organisation n'a aucune clé courante", async () => {
      const prisma = createFakePrisma({ signingKey: { findFirst: vi.fn().mockResolvedValue(null) } });
      const service = new OrganizationSigningKeyService(prisma as any);

      expect(await service.getKeyStatus("org-1")).toMatchObject({ active: false });
    });

    it("active=false + revokedAt renseigné si la clé courante est révoquée (transitoire, avant rotation)", async () => {
      const revokedAt = new Date("2026-08-15T00:00:00.000Z");
      const prisma = createFakePrisma({
        signingKey: {
          findFirst: vi.fn().mockResolvedValue({
            id: "key-1",
            organizationId: "org-1",
            publicKey: "pub",
            createdAt: new Date(),
            retiredAt: null,
            revokedAt,
          }),
        },
      });
      const service = new OrganizationSigningKeyService(prisma as any);

      expect(await service.getKeyStatus("org-1")).toMatchObject({ active: false, revokedAt });
    });
  });
});
