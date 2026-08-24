import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PendingMemberInviteService } from "./pending-member-invite.service";

function createFakeSmsProvider() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

// Merge PAR SOUS-OBJET (pas un spread superficiel au niveau racine) : un test
// qui override `pendingMemberInvite: { findFirst: ... }` conserve les autres
// méthodes par défaut (`count`, `create`, ...) au lieu de les remplacer par
// `undefined` — évite qu'un futur appel ajouté au service (ex. le `.count`
// du quota, revue post-fix #4) casse silencieusement tous les tests qui
// n'override que le champ qui les intéresse.
function createFakePrisma(overrides: Record<string, Record<string, unknown>> = {}) {
  const defaults: Record<string, Record<string, unknown>> = {
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue({ role: "owner" }),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue({ role: "practice_admin" }),
      create: vi.fn().mockResolvedValue({ id: "practice-member-1" }),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Boutique Aissatou", commercialTier: "pro" }),
    },
    professionalPractice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "practice-1", name: "Cabinet Mamadou" }),
    },
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    pendingMemberInvite: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "invite-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma: any = {};
  for (const key of Object.keys(defaults)) {
    prisma[key] = { ...defaults[key], ...(overrides[key] ?? {}) };
  }
  return prisma;
}

describe("PendingMemberInviteService", () => {
  describe("inviteToOrganization", () => {
    it("rejette un admin qui invite un pair admin — seul le owner peut", async () => {
      const prisma = createFakePrisma({
        organizationMember: {
          findUnique: vi.fn().mockResolvedValue({ role: "admin" }),
          count: vi.fn().mockResolvedValue(1),
        },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "admin" }, "requester-1"),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.pendingMemberInvite.create).not.toHaveBeenCalled();
    });

    it("rejette un rôle non débloqué par le palier commercial", async () => {
      const prisma = createFakePrisma({
        organization: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Boutique", commercialTier: "freemium" }),
        },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "developer_api" }, "requester-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejette si le quota de collaborateurs du palier est atteint", async () => {
      const prisma = createFakePrisma({
        organization: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Boutique", commercialTier: "freemium" }),
        },
        organizationMember: {
          findUnique: vi.fn().mockResolvedValue({ role: "owner" }),
          count: vi.fn().mockResolvedValue(1),
        },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "cashier" }, "requester-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejette si le numéro a déjà un compte facture.gn — utiliser l'invitation directe", async () => {
      const prisma = createFakePrisma({
        userPhone: { findUnique: vi.fn().mockResolvedValue({ userId: "user-existing" }) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "cashier" }, "requester-1"),
      ).rejects.toThrow(ConflictException);
    });

    it("rejette une invitation déjà en attente pour ce numéro et cette organisation", async () => {
      const prisma = createFakePrisma({
        pendingMemberInvite: {
          findFirst: vi.fn().mockResolvedValue({ id: "invite-existing" }),
          create: vi.fn(),
        },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "cashier" }, "requester-1"),
      ).rejects.toThrow(ConflictException);
      expect(prisma.pendingMemberInvite.create).not.toHaveBeenCalled();
    });

    it("compte les invitations en attente en plus des membres actifs pour le quota (revue post-fix #4)", async () => {
      const prisma = createFakePrisma({
        organization: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Boutique", commercialTier: "starter" }),
        },
        organizationMember: {
          findUnique: vi.fn().mockResolvedValue({ role: "owner" }),
          count: vi.fn().mockResolvedValue(3),
        },
        pendingMemberInvite: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(1) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      // starter autorise 4 membres (voir plan-features-grid.ts) : 3 actifs + 1
      // invitation déjà en attente = 4, la place restante est déjà engagée —
      // une nouvelle invitation doit être rejetée même si aucun membre actif
      // supplémentaire n'existe encore.
      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "cashier" }, "requester-1"),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.pendingMemberInvite.create).not.toHaveBeenCalled();
    });

    it("échoue proprement (409, pas 500 brut) si deux invitations concurrentes créent le doublon que le findFirst n'a pas vu (revue post-fix #1)", async () => {
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const prisma = createFakePrisma({
        pendingMemberInvite: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockRejectedValue(p2002),
        },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "cashier" }, "requester-1"),
      ).rejects.toThrow(ConflictException);
    });

    it("propage toute autre erreur de création telle quelle (pas absorbée par le catch de concurrence)", async () => {
      const prisma = createFakePrisma({
        pendingMemberInvite: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockRejectedValue(new Error("DB down")),
        },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToOrganization("org-1", { msisdn: "+224600000001", role: "cashier" }, "requester-1"),
      ).rejects.toThrow("DB down");
    });

    it("crée l'invitation et notifie l'invité par SMS, best-effort", async () => {
      const prisma = createFakePrisma();
      const smsProvider = createFakeSmsProvider();
      const service = new PendingMemberInviteService(prisma, smsProvider as any);

      const result = await service.inviteToOrganization(
        "org-1",
        { msisdn: "+224600000001", role: "cashier" },
        "requester-1",
      );

      expect(result).toEqual({ id: "invite-1" });
      expect(prisma.pendingMemberInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            msisdn: "+224600000001",
            role: "cashier",
            organizationId: "org-1",
            invitedByUserId: "requester-1",
          }),
        }),
      );
      expect(smsProvider.send).toHaveBeenCalledWith("+224600000001", expect.stringContaining("Boutique Aissatou"));
    });

    it("l'échec du provider SMS n'empêche jamais la création de l'invitation", async () => {
      const prisma = createFakePrisma();
      const smsProvider = { send: vi.fn().mockRejectedValue(new Error("provider down")) };
      const service = new PendingMemberInviteService(prisma, smsProvider as any);

      const result = await service.inviteToOrganization(
        "org-1",
        { msisdn: "+224600000001", role: "cashier" },
        "requester-1",
      );

      expect(result).toEqual({ id: "invite-1" });
    });
  });

  describe("inviteToPractice", () => {
    it("rejette un membre non practice_admin", async () => {
      const prisma = createFakePrisma({
        practiceMember: { findFirst: vi.fn().mockResolvedValue({ role: "accountant_external" }) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(
        service.inviteToPractice("practice-1", { msisdn: "+224600000001", role: "accountant_external" }, "requester-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("crée l'invitation cabinet et notifie l'invité", async () => {
      const prisma = createFakePrisma();
      const smsProvider = createFakeSmsProvider();
      const service = new PendingMemberInviteService(prisma, smsProvider as any);

      const result = await service.inviteToPractice(
        "practice-1",
        { msisdn: "+224600000001", role: "accountant_external" },
        "requester-1",
      );

      expect(result).toEqual({ id: "invite-1" });
      expect(prisma.pendingMemberInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ practiceId: "practice-1", role: "accountant_external" }),
        }),
      );
      expect(smsProvider.send).toHaveBeenCalledWith("+224600000001", expect.stringContaining("Cabinet Mamadou"));
    });
  });

  describe("resolveForNewUser", () => {
    it("résout une invitation organisation en attente vers un OrganizationMember", async () => {
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite-1", organizationId: "org-1", practiceId: null, role: "cashier" },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: { create: vi.fn().mockResolvedValue({ id: "member-1" }) },
        practiceMember: { create: vi.fn() },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await service.resolveForNewUser(tx, "new-user-1", "+224600000001");

      // Claim (updateMany+where) AVANT la création du membership — revue
      // post-fix #3 : ordre inverse de la version initiale.
      expect(tx.pendingMemberInvite.updateMany).toHaveBeenCalledWith({
        where: { id: "invite-1", acceptedAt: null, revokedAt: null },
        data: { acceptedAt: expect.any(Date), resolvedUserId: "new-user-1" },
      });
      expect(tx.organizationMember.create).toHaveBeenCalledWith({
        data: { organizationId: "org-1", userId: "new-user-1", role: "cashier" },
      });
      expect(tx.practiceMember.create).not.toHaveBeenCalled();
    });

    it("résout une invitation cabinet en attente vers un PracticeMember", async () => {
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite-1", organizationId: null, practiceId: "practice-1", role: "accountant_external" },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: { create: vi.fn() },
        practiceMember: { create: vi.fn().mockResolvedValue({ id: "practice-member-1" }) },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await service.resolveForNewUser(tx, "new-user-1", "+224600000001");

      expect(tx.practiceMember.create).toHaveBeenCalledWith({
        data: { practiceId: "practice-1", userId: "new-user-1", role: "accountant_external" },
      });
      expect(tx.organizationMember.create).not.toHaveBeenCalled();
    });

    it("résout PLUSIEURS invitations en attente pour le même numéro (organisation ET cabinet)", async () => {
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite-org", organizationId: "org-1", practiceId: null, role: "cashier" },
            { id: "invite-practice", organizationId: null, practiceId: "practice-1", role: "accountant_external" },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: { create: vi.fn().mockResolvedValue({ id: "member-1" }) },
        practiceMember: { create: vi.fn().mockResolvedValue({ id: "practice-member-1" }) },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await service.resolveForNewUser(tx, "new-user-1", "+224600000001");

      expect(tx.organizationMember.create).toHaveBeenCalledTimes(1);
      expect(tx.practiceMember.create).toHaveBeenCalledTimes(1);
      expect(tx.pendingMemberInvite.updateMany).toHaveBeenCalledTimes(2);
    });

    it("ne résout rien si aucune invitation n'est en attente pour ce numéro (chemin normal inchangé)", async () => {
      const tx: any = {
        pendingMemberInvite: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
        organizationMember: { create: vi.fn() },
        practiceMember: { create: vi.fn() },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await service.resolveForNewUser(tx, "new-user-1", "+224600000001");

      expect(tx.organizationMember.create).not.toHaveBeenCalled();
      expect(tx.practiceMember.create).not.toHaveBeenCalled();
      expect(tx.pendingMemberInvite.updateMany).not.toHaveBeenCalled();
    });

    it("une invitation expirée ou révoquée n'est jamais retournée par la requête de résolution (filtrée en base)", async () => {
      // La garde réelle vit dans le `where` de resolveForNewUser (expiresAt >
      // now, revokedAt: null, acceptedAt: null) — ce test vérifie que le where
      // exact est bien construit, pas seulement le comportement en aval.
      const tx: any = {
        pendingMemberInvite: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
        organizationMember: { create: vi.fn() },
        practiceMember: { create: vi.fn() },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await service.resolveForNewUser(tx, "new-user-1", "+224600000001");

      expect(tx.pendingMemberInvite.findMany).toHaveBeenCalledWith({
        where: {
          msisdn: "+224600000001",
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it("ne crée AUCUN membership si l'invitation a été révoquée entre le findMany et le claim (revue post-fix #3)", async () => {
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite-1", organizationId: "org-1", practiceId: null, role: "cashier" },
          ]),
          // count:0 — une révocation concurrente a gagné la course entre la
          // lecture et le claim.
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        organizationMember: { create: vi.fn() },
        practiceMember: { create: vi.fn() },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await service.resolveForNewUser(tx, "new-user-1", "+224600000001");

      expect(tx.organizationMember.create).not.toHaveBeenCalled();
      expect(tx.practiceMember.create).not.toHaveBeenCalled();
    });

    it("ignore une invitation dont le membership existe déjà (P2002), sans faire échouer la résolution des autres (revue post-fix #1)", async () => {
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite-dup", organizationId: "org-1", practiceId: null, role: "cashier" },
            { id: "invite-ok", organizationId: null, practiceId: "practice-1", role: "accountant_external" },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: { create: vi.fn().mockRejectedValue(p2002) },
        practiceMember: { create: vi.fn().mockResolvedValue({ id: "practice-member-1" }) },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      // Ne doit jamais lever — la transaction AuthService.register() qui
      // englobe cet appel ne doit jamais échouer pour un doublon de membership.
      await expect(service.resolveForNewUser(tx, "new-user-1", "+224600000001")).resolves.toBeUndefined();
      expect(tx.practiceMember.create).toHaveBeenCalledTimes(1);
    });

    it("ne crée AUCUN membership et ne lève pas si organizationId ET practiceId sont null (cible supprimée, revue post-fix #1)", async () => {
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: "invite-orphan", organizationId: null, practiceId: null, role: "cashier" }]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: { create: vi.fn() },
        practiceMember: { create: vi.fn() },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      // L'organisation ou le cabinet ciblé par l'invitation a été supprimé
      // (ON DELETE SET NULL, 20260824100000 + CHECK assoupli, 20260824110000)
      // entre l'envoi de l'invitation et l'inscription : le claim a déjà
      // marqué l'invitation acceptée, mais aucune cible ne subsiste pour
      // créer un membership — ne doit jamais lever.
      await expect(service.resolveForNewUser(tx, "new-user-1", "+224600000001")).resolves.toBeUndefined();
      expect(tx.organizationMember.create).not.toHaveBeenCalled();
      expect(tx.practiceMember.create).not.toHaveBeenCalled();
      expect(tx.pendingMemberInvite.updateMany).toHaveBeenCalledWith({
        where: { id: "invite-orphan", acceptedAt: null, revokedAt: null },
        data: { acceptedAt: expect.any(Date), resolvedUserId: "new-user-1" },
      });
    });

    it("propage toute autre erreur de création de membership (pas absorbée par le catch de doublon)", async () => {
      const tx: any = {
        pendingMemberInvite: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite-1", organizationId: "org-1", practiceId: null, role: "cashier" },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: { create: vi.fn().mockRejectedValue(new Error("DB down")) },
        practiceMember: { create: vi.fn() },
      };
      const service = new PendingMemberInviteService(createFakePrisma(), createFakeSmsProvider() as any);

      await expect(service.resolveForNewUser(tx, "new-user-1", "+224600000001")).rejects.toThrow("DB down");
    });
  });

  describe("revokeForOrganization", () => {
    it("révoque une invitation en attente (garde de concurrence updateMany+where)", async () => {
      const prisma = createFakePrisma();
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await service.revokeForOrganization("org-1", "invite-1");

      expect(prisma.pendingMemberInvite.updateMany).toHaveBeenCalledWith({
        where: { id: "invite-1", organizationId: "org-1", acceptedAt: null, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejette (404) si l'invitation n'existe pas ou est déjà résolue/révoquée", async () => {
      const prisma = createFakePrisma({
        pendingMemberInvite: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(service.revokeForOrganization("org-1", "invite-1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("revokeForPractice", () => {
    it("rejette un membre non practice_admin", async () => {
      const prisma = createFakePrisma({
        practiceMember: { findFirst: vi.fn().mockResolvedValue({ role: "accountant_external" }) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(service.revokeForPractice("practice-1", "invite-1", "requester-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("rejette (404) si l'invitation n'existe pas ou est déjà résolue/révoquée", async () => {
      const prisma = createFakePrisma({
        pendingMemberInvite: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(service.revokeForPractice("practice-1", "invite-1", "requester-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listPendingForOrganization / listPendingForPractice", () => {
    it("liste les invitations en attente d'une organisation", async () => {
      const prisma = createFakePrisma();
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await service.listPendingForOrganization("org-1");

      expect(prisma.pendingMemberInvite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
      );
    });

    it("liste les invitations en attente d'un cabinet, réservé au practice_admin", async () => {
      const prisma = createFakePrisma({
        practiceMember: { findFirst: vi.fn().mockResolvedValue({ role: "accountant_external" }) },
      });
      const service = new PendingMemberInviteService(prisma, createFakeSmsProvider() as any);

      await expect(service.listPendingForPractice("practice-1", "requester-1")).rejects.toThrow(ForbiddenException);
    });
  });
});
