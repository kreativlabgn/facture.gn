import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ClientPortalAuthService } from "./client-portal-auth.service";

const MSISDN = "+224622334455";

function createFakePrisma(overrides: { otp?: unknown; userPhone?: unknown } = {}) {
  const prisma: any = {
    clientPortalOtp: {
      create: vi.fn().mockResolvedValue({ id: "otp-1" }),
      findFirst: vi.fn().mockResolvedValue(overrides.otp ?? null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(overrides.userPhone ?? null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: "user-new" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

function createFakePasswordService(verifyResult = true) {
  return {
    hash: vi.fn().mockResolvedValue("$argon2id$otp-hash"),
    verify: vi.fn().mockResolvedValue(verifyResult),
    generateTemporaryPassword: vi.fn(),
  };
}

function createFakeTokenService() {
  return { sign: vi.fn().mockResolvedValue("signed.jwt.token"), verify: vi.fn() };
}

function createFakeSmsProvider() {
  return { send: vi.fn().mockResolvedValue({ success: true }) };
}

describe("ClientPortalAuthService", () => {
  describe("requestOtp", () => {
    it("génère un code, le hash, le stocke et l'envoie par SMS — jamais en clair en base", async () => {
      const prisma = createFakePrisma();
      const passwordService = createFakePasswordService();
      const smsProvider = createFakeSmsProvider();
      const service = new ClientPortalAuthService(prisma, passwordService as any, createFakeTokenService() as any, smsProvider as any);

      await service.requestOtp(MSISDN);

      expect(passwordService.hash).toHaveBeenCalledTimes(1);
      const [hashedCode] = passwordService.hash.mock.calls[0];
      expect(hashedCode).toMatch(/^\d{4}$/);

      expect(prisma.clientPortalOtp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ msisdn: MSISDN, codeHash: "$argon2id$otp-hash" }),
      });
      // Jamais le code en clair persisté — seul codeHash apparaît dans le payload d'écriture.
      const writeCall = prisma.clientPortalOtp.create.mock.calls[0][0];
      expect(JSON.stringify(writeCall)).not.toContain(hashedCode);

      expect(smsProvider.send).toHaveBeenCalledWith(MSISDN, expect.stringContaining(hashedCode));
    });

    it("répond de façon identique quel que soit le numéro — pas d'énumération possible côté appelant", async () => {
      const prisma = createFakePrisma();
      const service = new ClientPortalAuthService(
        prisma,
        createFakePasswordService() as any,
        createFakeTokenService() as any,
        createFakeSmsProvider() as any,
      );

      const result = await service.requestOtp(MSISDN);
      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe("verifyOtp", () => {
    it("rejette un code sans OTP en attente (jamais demandé, expiré, ou déjà consommé)", async () => {
      const prisma = createFakePrisma({ otp: null });
      const service = new ClientPortalAuthService(
        prisma,
        createFakePasswordService() as any,
        createFakeTokenService() as any,
        createFakeSmsProvider() as any,
      );

      await expect(service.verifyOtp(MSISDN, "1234")).rejects.toThrow(UnauthorizedException);
    });

    it("rejette un mauvais code et incrémente les tentatives, sans consommer l'OTP", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp });
      const passwordService = createFakePasswordService(false);
      const service = new ClientPortalAuthService(prisma, passwordService as any, createFakeTokenService() as any, createFakeSmsProvider() as any);

      await expect(service.verifyOtp(MSISDN, "0000")).rejects.toThrow(UnauthorizedException);

      expect(prisma.clientPortalOtp.update).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: expect.objectContaining({ attempts: 1, consumedAt: null }),
      });
      expect(prisma.clientPortalOtp.updateMany).not.toHaveBeenCalled();
    });

    it("brûle l'OTP après le nombre maximal de tentatives échouées", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 2 };
      const prisma = createFakePrisma({ otp });
      const passwordService = createFakePasswordService(false);
      const service = new ClientPortalAuthService(prisma, passwordService as any, createFakeTokenService() as any, createFakeSmsProvider() as any);

      await expect(service.verifyOtp(MSISDN, "0000")).rejects.toThrow(UnauthorizedException);

      expect(prisma.clientPortalOtp.update).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: expect.objectContaining({ attempts: 3, consumedAt: expect.any(Date) }),
      });
    });

    it("consomme l'OTP de façon atomique (updateMany+where) — un rejeu concurrent ne peut pas réutiliser le même code", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp });
      const service = new ClientPortalAuthService(
        prisma,
        createFakePasswordService(true) as any,
        createFakeTokenService() as any,
        createFakeSmsProvider() as any,
      );

      await service.verifyOtp(MSISDN, "1234");

      expect(prisma.clientPortalOtp.updateMany).toHaveBeenCalledWith({
        where: { id: "otp-1", consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it("rejette si la consommation atomique perd la course (count:0, déjà consommé par une requête concurrente)", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp });
      prisma.clientPortalOtp.updateMany.mockResolvedValue({ count: 0 });
      const service = new ClientPortalAuthService(
        prisma,
        createFakePasswordService(true) as any,
        createFakeTokenService() as any,
        createFakeSmsProvider() as any,
      );

      await expect(service.verifyOtp(MSISDN, "1234")).rejects.toThrow(UnauthorizedException);
    });

    it("réutilise l'User/UserPhone existant si le numéro est déjà connu (ex. collaborateur ailleurs) — jamais une double identité", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp, userPhone: { id: "phone-1", userId: "user-existing", verifiedAt: null } });
      const tokenService = createFakeTokenService();
      const service = new ClientPortalAuthService(prisma, createFakePasswordService(true) as any, tokenService as any, createFakeSmsProvider() as any);

      await service.verifyOtp(MSISDN, "1234");

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userPhone.update).toHaveBeenCalledWith({
        where: { id: "phone-1" },
        data: { verifiedAt: expect.any(Date) },
      });
      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-existing" });
    });

    it("crée un User + UserPhone vérifié à la volée pour un numéro totalement inconnu (auto-inscription, ADR-096)", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp, userPhone: null });
      const tokenService = createFakeTokenService();
      const service = new ClientPortalAuthService(prisma, createFakePasswordService(true) as any, tokenService as any, createFakeSmsProvider() as any);

      await service.verifyOtp(MSISDN, "1234");

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.userPhone.create).toHaveBeenCalledWith({
        data: { userId: "user-new", msisdn: MSISDN, isPrimary: true, verifiedAt: expect.any(Date) },
      });
      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-new" });
    });
  });
});
