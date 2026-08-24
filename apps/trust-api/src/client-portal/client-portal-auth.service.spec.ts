import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// F13, revue post-fix #5 — état de consommation partagé par closure, comme le
// mutex déjà établi dans ussd-session.service.spec.ts (Security Audit
// 2026-08-23, revue post-fix #2) : deux verifyOtp() partageant CETTE instance
// exercent le vrai comportement conditionnel updateMany(where:{consumedAt:null}),
// une seule des deux peut réussir — pas un count:0 forcé qui ne prouve rien.
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
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    user: { create: vi.fn().mockResolvedValue({ id: "user-new" }) },
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

    it("F13, revue post-fix #4 — invalide tout OTP précédent non consommé du même numéro avant d'en créer un nouveau", async () => {
      const prisma = createFakePrisma();
      const service = new ClientPortalAuthService(
        prisma,
        createFakePasswordService() as any,
        createFakeTokenService() as any,
        createFakeSmsProvider() as any,
      );

      await service.requestOtp(MSISDN);

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

    it("F13, revue post-fix #5 — deux verifyOtp() réellement concurrents avec le même code ne produisent qu'UN SEUL succès", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakeStatefulPrisma(otp);
      const service = new ClientPortalAuthService(
        prisma,
        createFakePasswordService(true) as any,
        createFakeTokenService() as any,
        createFakeSmsProvider() as any,
      );

      const results = await Promise.allSettled([service.verifyOtp(MSISDN, "1234"), service.verifyOtp(MSISDN, "1234")]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);
      // La consommation gagnante n'a jamais laissé passer une seconde
      // auto-inscription pour le même numéro — un seul User créé.
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
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
      // Cross-Story Audit 2026-08-24, finding #1 — scope:"client_portal" toujours
      // présent, même pour un numéro déjà connu (ex. collaborateur ailleurs) :
      // resolveOrCreateUser() ne change rien à la portée du token émis ensuite.
      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-existing", scope: "client_portal" });
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
      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-new", scope: "client_portal" });
    });

    it("Cross-Story Audit 2026-08-24, finding #1 CRITIQUE — signe toujours le token avec scope:\"client_portal\", jamais un token de portée complète", async () => {
      const otp = { id: "otp-1", codeHash: "$argon2id$otp-hash", attempts: 0 };
      const prisma = createFakePrisma({ otp, userPhone: { id: "phone-1", userId: "user-existing", verifiedAt: new Date() } });
      const tokenService = createFakeTokenService();
      const service = new ClientPortalAuthService(prisma, createFakePasswordService(true) as any, tokenService as any, createFakeSmsProvider() as any);

      await service.verifyOtp(MSISDN, "1234");

      const [signedPayload] = tokenService.sign.mock.calls[0];
      expect(signedPayload.scope).toBe("client_portal");
      // Non-régression : jamais un appel sans scope (qui reviendrait à émettre un
      // token de portée complète pour une simple vérification OTP).
      expect(signedPayload).not.toEqual({ sub: signedPayload.sub });
    });
  });

  // F10, revue post-fix #5 — la décision de NE JAMAIS résoudre PendingMemberInvite
  // depuis ce chemin (commentaire détaillé sur resolveOrCreateUser : un User
  // créé ici n'a ni passwordHash ni pinHash, un membership y serait fantôme et
  // inutilisable) n'avait aucun test de garde. Un test comportemental classique
  // ne peut pas la couvrir : PendingMemberInviteService n'est pas injecté dans
  // ce service, il n'y a donc rien à espionner à l'exécution — ce test
  // structurel vérifie directement que le fichier source ne l'importe/l'appelle
  // pas, pour qu'un futur "par cohérence avec AuthService.register()" soit
  // détecté au lieu de passer inaperçu.
  it("n'importe/n'appelle jamais PendingMemberInviteService (décision F10 délibérée)", () => {
    const source = readFileSync(join(__dirname, "client-portal-auth.service.ts"), "utf-8");
    // Le commentaire documentant CETTE décision mentionne légitimement
    // "PendingMemberInvite" en toutes lettres — seuls un import du module ou un
    // appel réel à resolveForNewUser() seraient une régression.
    expect(source).not.toMatch(/from\s+["'].*pending-member-invite/);
    expect(source).not.toMatch(/\.resolveForNewUser\(/);
  });
});
