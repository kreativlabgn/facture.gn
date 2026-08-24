import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ClientPortalAuthService } from "./client-portal-auth.service";

const MSISDN = "+224622334455";

function createFakePrisma(overrides: { userPhone?: unknown } = {}) {
  const prisma: any = {
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

// Cross-Story Audit 2026-08-24, finding #2 — ClientPortalOtpService est
// désormais injecté (extrait pour être réutilisé par AuthService.register()) :
// ClientPortalAuthService ne connaît plus le stockage/la vérification OTP en
// détail, seulement request()/verifyAndConsume(). Ce double par défaut résout
// avec succès — les tests de rejet OTP en dessous fournissent leur propre
// double.
function createFakeClientPortalOtp(overrides: { verifyAndConsume?: ReturnType<typeof vi.fn> } = {}) {
  return {
    request: vi.fn().mockResolvedValue(undefined),
    verifyAndConsume: overrides.verifyAndConsume ?? vi.fn().mockResolvedValue(undefined),
  };
}

function createFakeTokenService() {
  return { sign: vi.fn().mockResolvedValue("signed.jwt.token"), verify: vi.fn() };
}

describe("ClientPortalAuthService", () => {
  describe("requestOtp", () => {
    it("délègue la génération/le stockage/l'envoi du code à ClientPortalOtpService", async () => {
      const prisma = createFakePrisma();
      const clientPortalOtp = createFakeClientPortalOtp();
      const service = new ClientPortalAuthService(prisma, createFakeTokenService() as any, clientPortalOtp as any);

      const result = await service.requestOtp(MSISDN);

      expect(clientPortalOtp.request).toHaveBeenCalledWith(MSISDN);
      // Toujours le même message, que le numéro soit déjà connu ou non — la
      // résolution d'identité n'a lieu qu'à la vérification, jamais ici.
      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe("verifyOtp", () => {
    it("propage le rejet de ClientPortalOtpService.verifyAndConsume (OTP invalide/expiré) sans résoudre ni créer de User", async () => {
      const prisma = createFakePrisma();
      const clientPortalOtp = createFakeClientPortalOtp({
        verifyAndConsume: vi.fn().mockRejectedValue(new UnauthorizedException("Code invalide ou expiré")),
      });
      const service = new ClientPortalAuthService(prisma, createFakeTokenService() as any, clientPortalOtp as any);

      await expect(service.verifyOtp(MSISDN, "0000")).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userPhone.create).not.toHaveBeenCalled();
    });

    it("réutilise l'User/UserPhone existant si le numéro est déjà connu (ex. collaborateur ailleurs) — jamais une double identité", async () => {
      const prisma = createFakePrisma({ userPhone: { id: "phone-1", userId: "user-existing", verifiedAt: null } });
      const tokenService = createFakeTokenService();
      const service = new ClientPortalAuthService(prisma, tokenService as any, createFakeClientPortalOtp() as any);

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
      const prisma = createFakePrisma({ userPhone: null });
      const tokenService = createFakeTokenService();
      const service = new ClientPortalAuthService(prisma, tokenService as any, createFakeClientPortalOtp() as any);

      await service.verifyOtp(MSISDN, "1234");

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.userPhone.create).toHaveBeenCalledWith({
        data: { userId: "user-new", msisdn: MSISDN, isPrimary: true, verifiedAt: expect.any(Date) },
      });
      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-new", scope: "client_portal" });
    });

    it("Cross-Story Audit 2026-08-24, finding #1 CRITIQUE — signe toujours le token avec scope:\"client_portal\", jamais un token de portée complète", async () => {
      const prisma = createFakePrisma({
        userPhone: { id: "phone-1", userId: "user-existing", verifiedAt: new Date() },
      });
      const tokenService = createFakeTokenService();
      const service = new ClientPortalAuthService(prisma, tokenService as any, createFakeClientPortalOtp() as any);

      await service.verifyOtp(MSISDN, "1234");

      const [signedPayload] = tokenService.sign.mock.calls[0];
      expect(signedPayload.scope).toBe("client_portal");
      // Non-régression : jamais un appel sans scope (qui reviendrait à émettre un
      // token de portée complète pour une simple vérification OTP).
      expect(signedPayload).not.toEqual({ sub: signedPayload.sub });
    });

    it("Cross-Story Audit 2026-08-24, finding #2 — vérifie/consomme l'OTP via ClientPortalOtpService AVANT de résoudre/créer le User", async () => {
      const prisma = createFakePrisma({ userPhone: null });
      const clientPortalOtp = createFakeClientPortalOtp();
      const service = new ClientPortalAuthService(prisma, createFakeTokenService() as any, clientPortalOtp as any);

      await service.verifyOtp(MSISDN, "1234");

      expect(clientPortalOtp.verifyAndConsume).toHaveBeenCalledWith(MSISDN, "1234");
      const verifyOrder = clientPortalOtp.verifyAndConsume.mock.invocationCallOrder[0];
      const userLookupOrder = prisma.userPhone.findUnique.mock.invocationCallOrder[0];
      expect(verifyOrder).toBeLessThan(userLookupOrder);
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
