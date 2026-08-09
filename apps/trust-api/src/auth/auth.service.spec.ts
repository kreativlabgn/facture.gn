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
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

        await service.requestRecovery({ msisdn: "+224622334455", organizationNif: "GN12345678" });

        expect(prisma.accountRecoveryRequest.create).toHaveBeenCalledWith({
          data: { userId: "user-1", organizationId: "org-1" },
        });
      });

      it("ne crée aucune demande si le msisdn est inconnu, mais retourne le même message générique", async () => {
        const prisma = createFakePrismaForRecovery({ phone: null, organization: { id: "org-1" } });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

        const result = await service.requestRecovery({ msisdn: "+224699999999", organizationNif: "GN12345678" });

        expect(prisma.accountRecoveryRequest.create).not.toHaveBeenCalled();
        expect(result.message).toMatch(GENERIC_MESSAGE_MATCHER);
      });

      it("ne crée aucune demande si le nif ne correspond à aucune organisation, même message générique", async () => {
        const prisma = createFakePrismaForRecovery({ phone: { userId: "user-1" }, organization: null });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

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
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

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
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

        await expect(
          service.resolveRecovery("recovery-1", "user-2", "approved"),
        ).rejects.toThrow(/owner|admin/);
      });

      it("refuse que le demandeur approuve sa propre demande", async () => {
        const prisma = createFakePrismaForRecovery({
          recoveryRequest: { id: "recovery-1", userId: "user-1", organizationId: "org-1", status: "pending" },
        });
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

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
        const service = new AuthService(prisma, passwordService, createFakeTokenService());

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
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

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
        const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

        await expect(
          service.resolveRecovery("recovery-1", "user-2", "approved"),
        ).rejects.toThrow(/résolue/);
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
      const service = new AuthService(prisma as any, passwordService, createFakeTokenService());

      await service.addPhone("user-1", "+224699887766", "MotDePasse-Actuel-2026");

      expect(passwordService.verify).toHaveBeenCalledWith("$argon2id$hashed", "MotDePasse-Actuel-2026");
      expect(prisma.userPhone.create).toHaveBeenCalledWith({
        data: { userId: "user-1", msisdn: "+224699887766", isPrimary: false },
      });
    });

    it("refuse un mot de passe incorrect — un JWT volé seul ne doit jamais suffire à planter un numéro (revue sécurité)", async () => {
      const prisma = createFakePrismaForAddPhone();
      const service = new AuthService(prisma as any, createFakePasswordService(false), createFakeTokenService());

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
      const service = new AuthService(prisma as any, createFakePasswordService(true), createFakeTokenService());

      await expect(service.addPhone("user-1", "+224699887766", "MotDePasse-Actuel-2026")).rejects.toThrow(
        /existe déjà/,
      );
    });
  });

  describe("grantFieldAgentStatus (B5, ADR-045)", () => {
    it("passe isFieldAgent à true pour l'utilisateur donné", async () => {
      const prisma: any = {
        user: { update: vi.fn().mockResolvedValue({ id: "user-1", isFieldAgent: true }) },
      };
      const service = new AuthService(prisma, createFakePasswordService(), createFakeTokenService());

      await service.grantFieldAgentStatus("user-1");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { isFieldAgent: true },
      });
    });
  });
});
