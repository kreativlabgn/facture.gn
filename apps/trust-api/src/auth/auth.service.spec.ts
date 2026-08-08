import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";

function createFakePrisma(overrides: { existingPhone?: unknown; userPhoneWithUser?: unknown } = {}) {
  const prisma: any = {
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingPhone ?? overrides.userPhoneWithUser ?? null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

function createFakePasswordService(verifyResult = true) {
  return {
    hash: vi.fn().mockResolvedValue("$argon2id$hashed"),
    verify: vi.fn().mockResolvedValue(verifyResult),
  };
}

function createFakeTokenService() {
  return {
    sign: vi.fn().mockResolvedValue("signed.jwt.token"),
    verify: vi.fn(),
  };
}

describe("AuthService", () => {
  describe("register", () => {
    it("rejette un msisdn déjà utilisé", async () => {
      const prisma = createFakePrisma({ existingPhone: { id: "phone-1" } });
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

      await expect(
        service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" }),
      ).rejects.toThrow(/existe déjà/);
    });

    it("hash le mot de passe avant de créer l'utilisateur — jamais en clair", async () => {
      const prisma = createFakePrisma();
      const passwordService = createFakePasswordService();
      const service = new AuthService(prisma, passwordService, createFakeTokenService());

      await service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" });

      expect(passwordService.hash).toHaveBeenCalledWith("MotDePasse-Solide-2026");
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ passwordHash: "$argon2id$hashed" }),
      });
      expect(prisma.user.create).not.toHaveBeenCalledWith({
        data: expect.objectContaining({ passwordHash: "MotDePasse-Solide-2026" }),
      });
    });

    it("crée le numéro principal (user_phone) lié au nouvel utilisateur", async () => {
      const prisma = createFakePrisma();
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

      await service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" });

      expect(prisma.userPhone.create).toHaveBeenCalledWith({
        data: { userId: "user-1", msisdn: "+224622334455", isPrimary: true },
      });
    });
  });

  describe("login", () => {
    it("refuse un msisdn inconnu avec un message générique (anti-énumération)", async () => {
      const prisma = createFakePrisma({ userPhoneWithUser: null });
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

      await expect(
        service.login({ msisdn: "+224699999999", password: "peu importe" }),
      ).rejects.toThrow("Identifiants invalides");
    });

    it("refuse un mauvais mot de passe avec le même message générique", async () => {
      const prisma = createFakePrisma({
        userPhoneWithUser: { user: { id: "user-1", passwordHash: "$argon2id$hashed" } },
      });
      const service = new AuthService(prisma, createFakePasswordService(false), createFakeTokenService());

      await expect(
        service.login({ msisdn: "+224622334455", password: "mauvais-mot-de-passe" }),
      ).rejects.toThrow("Identifiants invalides");
    });

    it("émet un token signé avec le seul identifiant utilisateur en cas de succès", async () => {
      const prisma = createFakePrisma({
        userPhoneWithUser: { user: { id: "user-1", passwordHash: "$argon2id$hashed" } },
      });
      const tokenService = createFakeTokenService();
      const service = new AuthService(prisma, createFakePasswordService(true), tokenService);

      const result = await service.login({ msisdn: "+224622334455", password: "MotDePasse-Solide-2026" });

      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-1" });
      expect(result).toEqual({ accessToken: "signed.jwt.token" });
    });
  });
});
