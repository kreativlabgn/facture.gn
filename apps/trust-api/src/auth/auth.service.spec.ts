import { UnauthorizedException } from "@nestjs/common";
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
      // Cross-Story Audit 2026-08-24, finding #2 — chemin de réclamation d'un
      // compte fantôme F13 (register() sur un existingPhone.user.passwordHash null).
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

function createFakePasswordService(verifyResult = true) {
  return {
    hash: vi.fn().mockResolvedValue("$argon2id$hashed"),
    verify: vi.fn().mockResolvedValue(verifyResult),
    generateTemporaryPassword: vi.fn().mockReturnValue("temp-password-fixture"),
  };
}

function createFakeTokenService() {
  return {
    sign: vi.fn().mockResolvedValue("signed.jwt.token"),
    verify: vi.fn(),
  };
}

// Security Audit 2026-08-23, finding #14.
function createFakeTokenRevocation(overrides: { revoke?: ReturnType<typeof vi.fn> } = {}) {
  return { revoke: overrides.revoke ?? vi.fn().mockResolvedValue(undefined), isRevoked: vi.fn() };
}

// F10 — double par défaut minimal : la plupart des tests existants de ce
// fichier ne portent pas sur la résolution de PendingMemberInvite.
function createFakePendingMemberInvite(overrides: { resolveForNewUser?: ReturnType<typeof vi.fn> } = {}) {
  return { resolveForNewUser: overrides.resolveForNewUser ?? vi.fn().mockResolvedValue(undefined) };
}

// Cross-Story Audit 2026-08-24, finding #2 — double par défaut minimal :
// verifyAndConsume résout par défaut (la plupart des tests existants de ce
// fichier ne portent pas sur la réclamation de compte fantôme F13). Les tests
// dédiés à la réclamation ci-dessous fournissent leur propre double pour
// vérifier le rejet/l'acceptation selon la présence/validité de l'OTP.
function createFakeClientPortalOtp(overrides: { verifyAndConsume?: ReturnType<typeof vi.fn> } = {}) {
  return { verifyAndConsume: overrides.verifyAndConsume ?? vi.fn().mockResolvedValue(undefined), request: vi.fn() };
}

describe("AuthService", () => {
  describe("register", () => {
    it("rejette un msisdn déjà utilisé par un VRAI compte (passwordHash déjà posé)", async () => {
      const prisma = createFakePrisma({
        existingPhone: { id: "phone-1", userId: "user-existing", user: { id: "user-existing", passwordHash: "$argon2id$deja-pose" } },
      });
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await expect(
        service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" }),
      ).rejects.toThrow(/existe déjà/);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("hash le mot de passe avant de créer l'utilisateur — jamais en clair", async () => {
      const prisma = createFakePrisma();
      const passwordService = createFakePasswordService();
      const service = new AuthService(prisma, passwordService, createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" });

      expect(passwordService.hash).toHaveBeenCalledWith("MotDePasse-Solide-2026");
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ passwordHash: "$argon2id$hashed" }),
      });
      expect(prisma.user.create).not.toHaveBeenCalledWith({
        data: expect.objectContaining({ passwordHash: "MotDePasse-Solide-2026" }),
      });
    });

    it("F10 — résout toute PendingMemberInvite en attente pour ce numéro, dans la même transaction", async () => {
      const prisma = createFakePrisma();
      const pendingMemberInvite = createFakePendingMemberInvite();
      const service = new AuthService(
        prisma,
        createFakePasswordService(),
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        pendingMemberInvite as any,
        createFakeClientPortalOtp() as any,
      );

      const result = await service.register({
        name: "Aissatou Diallo",
        msisdn: "+224622334455",
        password: "MotDePasse-Solide-2026",
      });

      expect(pendingMemberInvite.resolveForNewUser).toHaveBeenCalledWith(prisma, result.userId, "+224622334455");
    });

    it("crée le numéro principal (user_phone) lié au nouvel utilisateur", async () => {
      const prisma = createFakePrisma();
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" });

      expect(prisma.userPhone.create).toHaveBeenCalledWith({
        data: { userId: "user-1", msisdn: "+224622334455", isPrimary: true },
      });
    });
  });

  describe("register — réclamation d'un compte fantôme F13 (Cross-Story Audit 2026-08-24, finding #2 CRITIQUE)", () => {
    function createFakePrismaForClaim() {
      const prisma: any = {
        userPhone: {
          findUnique: vi.fn().mockResolvedValue({
            id: "phone-1",
            userId: "user-ghost",
            msisdn: "+224622334455",
            user: { id: "user-ghost", name: "+224622334455", passwordHash: null },
          }),
          create: vi.fn(),
        },
        user: {
          create: vi.fn(),
          // Cross-Story Audit 2026-08-24, finding #2 (course résiduelle) —
          // updateMany (pas update) : reflète le fix, count:1 par défaut (aucune
          // course dans ce fake — voir le test dédié plus bas pour le cas
          // count:0).
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: vi.fn((callback: any) => callback(prisma)),
      };
      return prisma;
    }

    it("rejette la réclamation SANS otpCode fourni — aucune écriture, aucune preuve de possession du téléphone", async () => {
      const prisma = createFakePrismaForClaim();
      const clientPortalOtp = createFakeClientPortalOtp();
      const service = new AuthService(
        prisma,
        createFakePasswordService(),
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        createFakePendingMemberInvite() as any,
        clientPortalOtp as any,
      );

      await expect(
        service.register({ name: "Aissatou Diallo", msisdn: "+224622334455", password: "MotDePasse-Solide-2026" }),
      ).rejects.toThrow(UnauthorizedException);

      expect(clientPortalOtp.verifyAndConsume).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejette la réclamation AVEC un otpCode invalide (délégué à ClientPortalOtpService, jamais revérifié ici)", async () => {
      const prisma = createFakePrismaForClaim();
      const clientPortalOtp = createFakeClientPortalOtp({
        verifyAndConsume: vi.fn().mockRejectedValue(new UnauthorizedException("Code invalide ou expiré")),
      });
      const service = new AuthService(
        prisma,
        createFakePasswordService(),
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        createFakePendingMemberInvite() as any,
        clientPortalOtp as any,
      );

      await expect(
        service.register({
          name: "Aissatou Diallo",
          msisdn: "+224622334455",
          password: "MotDePasse-Solide-2026",
          otpCode: "0000",
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(clientPortalOtp.verifyAndConsume).toHaveBeenCalledWith("+224622334455", "0000");
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it("pose le mot de passe sur le compte fantôme existant quand l'otpCode est valide, au lieu de rejeter", async () => {
      const prisma = createFakePrismaForClaim();
      const passwordService = createFakePasswordService();
      const clientPortalOtp = createFakeClientPortalOtp();
      const service = new AuthService(
        prisma,
        passwordService,
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        createFakePendingMemberInvite() as any,
        clientPortalOtp as any,
      );

      const result = await service.register({
        name: "Aissatou Diallo",
        msisdn: "+224622334455",
        password: "MotDePasse-Solide-2026",
        otpCode: "1234",
      });

      expect(prisma.userPhone.findUnique).toHaveBeenCalledWith({
        where: { msisdn: "+224622334455" },
        include: { user: true },
      });
      expect(clientPortalOtp.verifyAndConsume).toHaveBeenCalledWith("+224622334455", "1234");
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "user-ghost", passwordHash: null },
        data: { name: "Aissatou Diallo", passwordHash: "$argon2id$hashed" },
      });
      // Jamais un nouveau User/UserPhone créé — c'est une réclamation, pas une création.
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userPhone.create).not.toHaveBeenCalled();
      expect(result.userId).toBe("user-ghost");
    });

    it("résout, dans la même transaction, toute PendingMemberInvite en attente pour ce numéro, quand l'otpCode est valide", async () => {
      const prisma = createFakePrismaForClaim();
      const pendingMemberInvite = createFakePendingMemberInvite();
      const service = new AuthService(
        prisma,
        createFakePasswordService(),
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        pendingMemberInvite as any,
        createFakeClientPortalOtp() as any,
      );

      await service.register({
        name: "Aissatou Diallo",
        msisdn: "+224622334455",
        password: "MotDePasse-Solide-2026",
        otpCode: "1234",
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(pendingMemberInvite.resolveForNewUser).toHaveBeenCalledWith(prisma, "user-ghost", "+224622334455");
    });

    it("Cross-Story Audit 2026-08-24, finding #2 (course résiduelle) — rejette proprement si le compte n'est plus fantôme au moment de l'écriture (updateMany count:0), sans écraser le mot de passe déjà posé", async () => {
      const prisma = createFakePrismaForClaim();
      prisma.user.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const pendingMemberInvite = createFakePendingMemberInvite();
      const service = new AuthService(
        prisma,
        createFakePasswordService(),
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        pendingMemberInvite as any,
        createFakeClientPortalOtp() as any,
      );

      await expect(
        service.register({
          name: "Aissatou Diallo",
          msisdn: "+224622334455",
          password: "MotDePasse-Solide-2026",
          otpCode: "1234",
        }),
      ).rejects.toThrow(/déjà été réclamé/);

      // La transaction a bien été tentée (l'OTP était valide), mais rollback
      // logique : PendingMemberInvite ne doit jamais être résolue pour une
      // réclamation qui n'a pas réellement eu lieu.
      expect(pendingMemberInvite.resolveForNewUser).not.toHaveBeenCalled();
    });

    it("Cross-Story Audit 2026-08-24, finding #2 (course résiduelle) — deux réclamations concurrentes du même compte fantôme, chacune avec un OTP valide : une seule réussit, l'autre échoue proprement sans écraser le mot de passe du gagnant", async () => {
      // Simule la garde réelle updateMany(where:{id, passwordHash:null}) sous
      // Read Committed : la première écriture qui s'exécute voit encore
      // passwordHash:null et gagne (count:1) ; la seconde, exécutée après,
      // trouve passwordHash déjà posé et perd (count:0) — jamais un second
      // écrasement silencieux du mot de passe déjà réclamé.
      let claimed = false;
      const prisma: any = {
        userPhone: {
          findUnique: vi.fn().mockResolvedValue({
            id: "phone-1",
            userId: "user-ghost",
            msisdn: "+224622334455",
            user: { id: "user-ghost", name: "+224622334455", passwordHash: null },
          }),
          create: vi.fn(),
        },
        user: {
          create: vi.fn(),
          updateMany: vi.fn().mockImplementation(() => {
            if (claimed) return Promise.resolve({ count: 0 });
            claimed = true;
            return Promise.resolve({ count: 1 });
          }),
        },
        $transaction: vi.fn((callback: any) => callback(prisma)),
      };
      // Les deux "attaquants" présentent chacun un otpCode que ClientPortalOtpService
      // considère valide (cas improbable — deux OTP valides simultanément pour le
      // même numéro — mais à couvrir : la garde qui compte ici est celle posée sur
      // User.updateMany, pas l'atomicité de l'OTP lui-même).
      const clientPortalOtp = createFakeClientPortalOtp();
      const pendingMemberInvite = createFakePendingMemberInvite();
      const service = new AuthService(
        prisma,
        createFakePasswordService(),
        createFakeTokenService(),
        createFakeTokenRevocation() as any,
        pendingMemberInvite as any,
        clientPortalOtp as any,
      );

      const results = await Promise.allSettled([
        service.register({
          name: "Attaquant",
          msisdn: "+224622334455",
          password: "MotDePasse-Attaquant-2026",
          otpCode: "1111",
        }),
        service.register({
          name: "Victime",
          msisdn: "+224622334455",
          password: "MotDePasse-Victime-2026",
          otpCode: "2222",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/déjà été réclamé/);
      // Une seule résolution de PendingMemberInvite — jamais deux, jamais pour
      // le perdant de la course.
      expect(pendingMemberInvite.resolveForNewUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("login", () => {
    it("refuse un msisdn inconnu avec un message générique (anti-énumération)", async () => {
      const prisma = createFakePrisma({ userPhoneWithUser: null });
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await expect(
        service.login({ msisdn: "+224699999999", password: "peu importe" }),
      ).rejects.toThrow("Identifiants invalides");
    });

    it("refuse un mauvais mot de passe avec le même message générique", async () => {
      const prisma = createFakePrisma({
        userPhoneWithUser: { user: { id: "user-1", passwordHash: "$argon2id$hashed" } },
      });
      const service = new AuthService(prisma, createFakePasswordService(false), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await expect(
        service.login({ msisdn: "+224622334455", password: "mauvais-mot-de-passe" }),
      ).rejects.toThrow("Identifiants invalides");
    });

    it("émet un token signé avec le seul identifiant utilisateur en cas de succès", async () => {
      const prisma = createFakePrisma({
        userPhoneWithUser: { user: { id: "user-1", passwordHash: "$argon2id$hashed" } },
      });
      const tokenService = createFakeTokenService();
      const service = new AuthService(prisma, createFakePasswordService(true), tokenService, createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      const result = await service.login({ msisdn: "+224622334455", password: "MotDePasse-Solide-2026" });

      expect(tokenService.sign).toHaveBeenCalledWith({ sub: "user-1" });
      expect(result).toEqual({ accessToken: "signed.jwt.token" });
    });
  });

  describe("logout (Security Audit 2026-08-23, finding #14)", () => {
    it("révoque le jti du token courant avec son expiration convertie en Date", async () => {
      const prisma = createFakePrisma();
      const tokenRevocation = createFakeTokenRevocation();
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), tokenRevocation as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await service.logout("jti-abc", 1893456000);

      expect(tokenRevocation.revoke).toHaveBeenCalledWith("jti-abc", new Date(1893456000 * 1000));
    });
  });

  describe("récupération de compte (B3, ADR-042)", () => {
    function createFakePrismaForRecovery(opts: {
      phone?: any;
      organization?: any;
      membership?: any;
      existingPendingRequest?: any;
      recoveryRequest?: any;
      updateManyCount?: number;
    } = {}) {
      const prisma: any = {
        userPhone: {
          findUnique: vi.fn().mockResolvedValue(opts.phone ?? null),
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue(opts.organization ?? null),
          update: vi.fn().mockResolvedValue({}),
        },
        organizationMember: {
          findUnique: vi.fn().mockResolvedValue(opts.membership ?? null),
        },
        accountRecoveryRequest: {
          findFirst: vi.fn().mockResolvedValue(opts.existingPendingRequest ?? null),
          create: vi.fn().mockResolvedValue({ id: "recovery-1" }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(opts.recoveryRequest),
          updateMany: vi.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
        },
        user: {
          update: vi.fn().mockResolvedValue({ id: "user-1" }),
        },
        $transaction: vi.fn((callback: any) => callback(prisma)),
      };
      return prisma;
    }

    const GENERIC_MESSAGE_MATCHER = /demande/;

    describe("requestRecovery", () => {
      it("crée une demande pending quand msisdn+nif correspondent à un membre actif", async () => {
        const prisma = createFakePrismaForRecovery({
          phone: { userId: "user-1" },
          organization: { id: "org-1" },
          membership: { role: "owner", revokedAt: null },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        await service.requestRecovery({ msisdn: "+224622334455", organizationNif: "GN12345678" });

        expect(prisma.accountRecoveryRequest.create).toHaveBeenCalledWith({
          data: { userId: "user-1", organizationId: "org-1" },
        });
      });

      it("ne crée aucune demande si le msisdn est inconnu, mais retourne le même message générique", async () => {
        const prisma = createFakePrismaForRecovery({ phone: null, organization: { id: "org-1" } });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        const result = await service.requestRecovery({ msisdn: "+224699999999", organizationNif: "GN12345678" });

        expect(prisma.accountRecoveryRequest.create).not.toHaveBeenCalled();
        expect(result.message).toMatch(GENERIC_MESSAGE_MATCHER);
      });

      it("ne crée aucune demande si le nif ne correspond à aucune organisation, même message générique", async () => {
        const prisma = createFakePrismaForRecovery({ phone: { userId: "user-1" }, organization: null });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        const result = await service.requestRecovery({ msisdn: "+224622334455", organizationNif: "NIF-INCONNU" });

        expect(prisma.accountRecoveryRequest.create).not.toHaveBeenCalled();
        expect(result.message).toMatch(GENERIC_MESSAGE_MATCHER);
      });

      it("ne crée aucune demande pour un membre non-owner — B3 est scopé au owner (ferme le mouvement latéral admin→admin, revue sécurité)", async () => {
        const prisma = createFakePrismaForRecovery({
          phone: { userId: "user-1" },
          organization: { id: "org-1" },
          membership: { role: "admin", revokedAt: null },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        const result = await service.requestRecovery({ msisdn: "+224622334455", organizationNif: "GN12345678" });

        expect(prisma.accountRecoveryRequest.create).not.toHaveBeenCalled();
        expect(result.message).toMatch(GENERIC_MESSAGE_MATCHER);
      });
    });

    describe("resolveRecovery", () => {
      it("refuse un approbateur qui n'est ni owner ni admin de l'organisation de la demande", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
          membership: { role: "cashier", revokedAt: null },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        await expect(
          service.resolveRecovery("recovery-1", "user-2", "approved"),
        ).rejects.toThrow(/owner|admin/);
      });

      it("refuse que le demandeur approuve sa propre demande", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        await expect(
          service.resolveRecovery("recovery-1", "user-1", "approved"),
        ).rejects.toThrow(/propre demande/);
      });

      it("génère un mot de passe temporaire et met à jour passwordHash sur approbation", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
          membership: { role: "admin", revokedAt: null },
        });
        const passwordService = createFakePasswordService();
        passwordService.generateTemporaryPassword = vi.fn().mockReturnValue("temp-Pw-XyZ12345");
        const service = new AuthService(prisma, passwordService, createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        const result = await service.resolveRecovery("recovery-1", "user-2", "approved");

        expect(result.temporaryPassword).toBe("temp-Pw-XyZ12345");
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { passwordHash: "$argon2id$hashed" },
        });
      });

      it("ne touche jamais passwordHash sur rejet", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
          membership: { role: "owner", revokedAt: null },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        const result = await service.resolveRecovery("recovery-1", "user-2", "rejected");

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(result.temporaryPassword).toBeNull();
      });

      it("refuse une double résolution concurrente d'une même demande", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
          membership: { role: "owner", revokedAt: null },
          updateManyCount: 0,
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        await expect(
          service.resolveRecovery("recovery-1", "user-2", "approved"),
        ).rejects.toThrow(/résolue/);
      });

      it("gèle l'organisation 24h sur approbation (G2, réinterprété — fenêtre de vigilance post-récupération)", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
          membership: { role: "admin", revokedAt: null },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);
        const before = Date.now();

        await service.resolveRecovery("recovery-1", "user-2", "approved");

        expect(prisma.organization.update).toHaveBeenCalledTimes(1);
        const call = prisma.organization.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: "org-1" });
        const frozenUntil = call.data.paymentsFrozenUntil.getTime();
        expect(frozenUntil).toBeGreaterThanOrEqual(before + 23.9 * 3600_000);
        expect(frozenUntil).toBeLessThanOrEqual(before + 24.1 * 3600_000);
      });

      it("ne gèle jamais l'organisation sur rejet", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
          membership: { role: "owner", revokedAt: null },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

        await service.resolveRecovery("recovery-1", "user-2", "rejected");

        expect(prisma.organization.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("addPhone (B6, ADR-087)", () => {
    function createFakePrismaForAddPhone(createImpl?: ReturnType<typeof vi.fn>) {
      return {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "user-1", passwordHash: "$argon2id$hashed" }),
        },
        userPhone: {
          create: createImpl ?? vi.fn().mockResolvedValue({ id: "phone-2", userId: "user-1", msisdn: "+224699887766", isPrimary: false }),
        },
      };
    }

    it("crée un second numéro non-primaire quand le mot de passe fourni est correct", async () => {
      const prisma = createFakePrismaForAddPhone();
      const passwordService = createFakePasswordService(true);
      const service = new AuthService(prisma as any, passwordService, createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await service.addPhone("user-1", "+224699887766", "MotDePasse-Actuel-2026");

      expect(passwordService.verify).toHaveBeenCalledWith("$argon2id$hashed", "MotDePasse-Actuel-2026");
      expect(prisma.userPhone.create).toHaveBeenCalledWith({
        data: { userId: "user-1", msisdn: "+224699887766", isPrimary: false },
      });
    });

    it("refuse un mot de passe incorrect — un JWT volé seul ne doit jamais suffire à planter un numéro (revue sécurité)", async () => {
      const prisma = createFakePrismaForAddPhone();
      const service = new AuthService(prisma as any, createFakePasswordService(false), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await expect(service.addPhone("user-1", "+224699887766", "mauvais-mot-de-passe")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.userPhone.create).not.toHaveBeenCalled();
    });

    it("refuse un msisdn déjà utilisé par n'importe quel compte, jamais un 500 brut", async () => {
      const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["msisdn"] },
      });
      const prisma = createFakePrismaForAddPhone(vi.fn().mockRejectedValue(uniqueViolation));
      const service = new AuthService(prisma as any, createFakePasswordService(true), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await expect(service.addPhone("user-1", "+224699887766", "MotDePasse-Actuel-2026")).rejects.toThrow(
        /existe déjà/,
      );
    });
  });

  describe("grantCommercialAgentStatus (B5, ADR-045, ADR-107)", () => {
    it("passe isCommercialAgent à true pour l'utilisateur donné", async () => {
      const prisma: any = {
        user: { update: vi.fn().mockResolvedValue({ id: "user-1", isCommercialAgent: true }) },
      };
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService(), createFakeTokenRevocation() as any, createFakePendingMemberInvite() as any, createFakeClientPortalOtp() as any);

      await service.grantCommercialAgentStatus("user-1");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { isCommercialAgent: true },
      });
    });
  });
});
