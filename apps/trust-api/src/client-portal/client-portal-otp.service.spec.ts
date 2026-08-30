import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ClientPortalOtpService } from "./client-portal-otp.service";

const MSISDN = "+224622334455";

function createFakePrisma(overrides: { otp?: unknown; customers?: unknown[] } = {}) {
  const prisma: any = {
    clientPortalOtp: {
      create: vi.fn().mockResolvedValue({ id: "otp-1" }),
      findFirst: vi.fn().mockResolvedValue(overrides.otp ?? null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customer: {
      findMany: vi.fn().mockResolvedValue(overrides.customers ?? []),
    },
  };
  return prisma;
}

// F13, revue post-fix #5 — état de consommation partagé par closure, comme le
// mutex déjà établi dans ussd-session.service.spec.ts (Security Audit
// 2026-08-23, revue post-fix #2) : deux verifyAndConsume() partageant CETTE
// instance exercent le vrai comportement conditionnel
// updateMany(where:{consumedAt:null}), une seule des deux peut réussir — pas
// un count:0 forcé qui ne prouve rien.
function createFakeStatefulPrisma(otp: { id: string; codeHash: string; attempts: number }) {
  let consumedAt: Date | null = null;
  const prisma: any = {
    clientPortalOtp: {
      create: vi.fn().mockResolvedValue({ id: "otp-1" }),
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(consumedAt === null ? { ...otp } : null)),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id === otp.id && consumedAt === null) {
          consumedAt = new Date();
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }),
    },
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

function createFakeSmsProvider() {
  return { send: vi.fn().mockResolvedValue({ success: true }) };
}

// Cross-Story Audit 2026-08-24, finding #2 — service extrait de
// ClientPortalAuthService pour être réutilisable par AuthService.register()
// (réclamation d'un compte fantôme F13). Ces tests reprennent la couverture
// OTP qui vivait auparavant dans client-portal-auth.service.spec.ts, adaptée
// au nouveau découpage (request()/verifyAndConsume() sans résolution/création
// de User ni émission de token — hors périmètre de ce service).
describe("ClientPortalOtpService", () => {
  describe("request", () => {
    it("génère un code, le hash, le stocke et l'envoie par SMS — jamais en clair en base", async () => {
      const prisma = createFakePrisma();
      const passwordService = createFakePasswordService();
      const smsProvider = createFakeSmsProvider();
      const service = new ClientPortalOtpService(prisma, passwordService as any, smsProvider as any);

      await service.request(MSISDN);

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

    it("résout la langue via les organisations rattachées au numéro (i18n)", async () => {
      const prisma = createFakePrisma({
        customers: [
          { organization: { preferredLanguage: "pular" } },
          { organization: { preferredLanguage: "fr" } },
        ],
      });
      const smsProvider = createFakeSmsProvider();
      const service = new ClientPortalOtpService(prisma, createFakePasswordService() as any, smsProvider as any);

      await service.request(MSISDN);

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: MSISDN } }),
      );
      // 2 langues distinctes → fr ; pular étant un stub vide, le message reste
      // FR de toute façon. On vérifie surtout que la résolution ne casse rien.
      expect(smsProvider.send).toHaveBeenCalledWith(
        MSISDN,
        expect.stringMatching(/^Votre code facture\.gn : \d{4} \(valable 5 minutes\)\.$/),
      );
    });

    it("ne lève jamais si la résolution de langue échoue", async () => {
      const prisma = createFakePrisma();
      prisma.customer.findMany = vi.fn().mockRejectedValue(new Error("db down"));
      const smsProvider = createFakeSmsProvider();
      const service = new ClientPortalOtpService(prisma, createFakePasswordService() as any, smsProvider as any);

      await expect(service.request(MSISDN)).resolves.toBeUndefined();
      expect(smsProvider.send).toHaveBeenCalledOnce();
    });

    it("F13, revue post-fix #4 — invalide tout OTP précédent non consommé du même numéro avant d'en créer un nouveau", async () => {
      const prisma = createFakePrisma();
      const service = new ClientPortalOtpService(
        prisma,
        createFakePasswordService() as any,
        createFakeSmsProvider() as any,
      );

      await service.request(MSISDN);

      expect(prisma.clientPortalOtp.updateMany).toHaveBeenCalledWith({
        where: { msisdn: MSISDN, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      // Invalidation AVANT création — un attaquant ne peut jamais se retrouver
      // avec deux OTP valides simultanément pour le même numéro.
      const invalidateOrder = prisma.clientPortalOtp.updateMany.mock.invocationCallOrder[0];
      const createOrder = prisma.clientPortalOtp.create.mock.invocationCallOrder[0];
      expect(invalidateOrder).toBeLessThan(createOrder);
    });
  });

  describe("verifyAndConsume", () => {
    it("rejette un code sans OTP en attente (jamais demandé, expiré, ou déjà consommé)", async () => {
      const prisma = createFakePrisma({ otp: null });
      const service = new ClientPortalOtpService(
        prisma,
        createFakePasswordService() as any,
        createFakeSmsProvider() as any,
      );

      await expect(service.verifyAndConsume(MSISDN, "1234")).rejects.toThrow(UnauthorizedException);
    });

    it("rejette un mauvais code et incrémente les tentatives, sans consommer l'OTP", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp });
      const passwordService = createFakePasswordService(false);
      const service = new ClientPortalOtpService(prisma, passwordService as any, createFakeSmsProvider() as any);

      await expect(service.verifyAndConsume(MSISDN, "0000")).rejects.toThrow(UnauthorizedException);

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
      const service = new ClientPortalOtpService(prisma, passwordService as any, createFakeSmsProvider() as any);

      await expect(service.verifyAndConsume(MSISDN, "0000")).rejects.toThrow(UnauthorizedException);

      expect(prisma.clientPortalOtp.update).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: expect.objectContaining({ attempts: 3, consumedAt: expect.any(Date) }),
      });
    });

    it("consomme l'OTP de façon atomique (updateMany+where) — un rejeu concurrent ne peut pas réutiliser le même code", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp });
      const service = new ClientPortalOtpService(
        prisma,
        createFakePasswordService(true) as any,
        createFakeSmsProvider() as any,
      );

      await service.verifyAndConsume(MSISDN, "1234");

      expect(prisma.clientPortalOtp.updateMany).toHaveBeenCalledWith({
        where: { id: "otp-1", consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it("F13, revue post-fix #5 — deux verifyAndConsume() réellement concurrents avec le même code ne produisent qu'UN SEUL succès", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakeStatefulPrisma(otp);
      const service = new ClientPortalOtpService(
        prisma,
        createFakePasswordService(true) as any,
        createFakeSmsProvider() as any,
      );

      const results = await Promise.allSettled([
        service.verifyAndConsume(MSISDN, "1234"),
        service.verifyAndConsume(MSISDN, "1234"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);
    });
  });
});
