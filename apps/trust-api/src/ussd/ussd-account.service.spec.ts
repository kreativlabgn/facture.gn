import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// organizationScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes sur les arguments inchangées.
// (La pose effective du set_config est couverte par packages/db rls.spec.ts.)
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}
import { UssdAccountService } from "./ussd-account.service";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const MANDATE_ID = "mandate-1";
const PHONE = "+224622334455";

function createFakePrisma(overrides: { organization?: any; requesterMembership?: any } = {}) {
  return auClientScope({
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.organization ?? { id: ORG_ID, phone: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    userPhone: {
      findFirst: vi.fn().mockResolvedValue({ msisdn: PHONE, user: { preferredLanguage: "fr" } }),
    },
    organizationMember: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.requesterMembership !== undefined
          ? overrides.requesterMembership
          : { organizationId: ORG_ID, userId: USER_ID, role: "owner", revokedAt: null },
      ),
    },
  });
}

function createFakeOrganizationsService(overrides: { inviteMember?: ReturnType<typeof vi.fn> } = {}) {
  return {
    inviteMember: overrides.inviteMember ?? vi.fn().mockResolvedValue({ id: "member-1", role: "viewer" }),
  };
}

function createFakeUssdAuth() {
  return { createPin: vi.fn().mockResolvedValue(undefined) };
}

function createFakeVelocityTier(overrides: { resolveTier?: ReturnType<typeof vi.fn> } = {}) {
  return { resolveTier: overrides.resolveTier ?? vi.fn().mockResolvedValue("T1") };
}

function createFakeMandatesService(overrides: {
  listPendingForOrganization?: ReturnType<typeof vi.fn>;
  listActiveForOrganization?: ReturnType<typeof vi.fn>;
  accept?: ReturnType<typeof vi.fn>;
  revokeAsOrganization?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    listPendingForOrganization: overrides.listPendingForOrganization ?? vi.fn().mockResolvedValue([]),
    listActiveForOrganization: overrides.listActiveForOrganization ?? vi.fn().mockResolvedValue([]),
    accept: overrides.accept ?? vi.fn().mockResolvedValue({ id: MANDATE_ID }),
    revokeAsOrganization: overrides.revokeAsOrganization ?? vi.fn().mockResolvedValue({ id: MANDATE_ID }),
  };
}

function createFakeSmsProvider() {
  return { send: vi.fn().mockResolvedValue({ success: true }) };
}

describe("UssdAccountService — changer le PIN (5.1, §3.3 Spec USSD)", () => {
  it("crée le nouveau PIN, gèle 24h vers T0, envoie un SMS systématique", async () => {
    const prisma = createFakePrisma();
    const ussdAuth = createFakeUssdAuth();
    const sms = createFakeSmsProvider();
    const service = new UssdAccountService(
      prisma as any,
      ussdAuth as any,
      createFakeVelocityTier() as any,
      createFakeMandatesService() as any,
      sms as any,
      createFakeOrganizationsService() as any,
    );
    const before = Date.now();

    await service.changePin(USER_ID, ORG_ID, "5678");

    expect(ussdAuth.createPin).toHaveBeenCalledWith(USER_ID, "5678");
    const call = prisma.organization.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: ORG_ID });
    const frozenUntil = call.data.paymentsFrozenUntil.getTime();
    expect(frozenUntil).toBeGreaterThanOrEqual(before + 23.9 * 3600_000);
    expect(frozenUntil).toBeLessThanOrEqual(before + 24.1 * 3600_000);
    expect(sms.send).toHaveBeenCalledWith(PHONE, expect.stringContaining("PIN"));
  });
});

describe("UssdAccountService — voir mon palier (5.2)", () => {
  it("délègue à VelocityTierService.resolveTier", async () => {
    const velocityTier = createFakeVelocityTier({ resolveTier: vi.fn().mockResolvedValue("T2") });
    const service = new UssdAccountService(
      createFakePrisma() as any,
      createFakeUssdAuth() as any,
      velocityTier as any,
      createFakeMandatesService() as any,
      createFakeSmsProvider() as any,
      createFakeOrganizationsService() as any,
    );

    await expect(service.getTierSummary(ORG_ID)).resolves.toBe("T2");
  });
});

describe("UssdAccountService — mandats (5.3/5.4)", () => {
  it("liste les mandats en attente via MandatesService", async () => {
    const mandates = createFakeMandatesService({ listPendingForOrganization: vi.fn().mockResolvedValue([{ id: MANDATE_ID }]) });
    const service = new UssdAccountService(
      createFakePrisma() as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      mandates as any,
      createFakeSmsProvider() as any,
      createFakeOrganizationsService() as any,
    );

    await expect(service.listPendingMandates(ORG_ID)).resolves.toEqual([{ id: MANDATE_ID }]);
  });

  it("liste les mandats actifs via MandatesService", async () => {
    const mandates = createFakeMandatesService({ listActiveForOrganization: vi.fn().mockResolvedValue([{ id: MANDATE_ID }]) });
    const service = new UssdAccountService(
      createFakePrisma() as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      mandates as any,
      createFakeSmsProvider() as any,
      createFakeOrganizationsService() as any,
    );

    await expect(service.listActiveMandates(ORG_ID)).resolves.toEqual([{ id: MANDATE_ID }]);
  });

  it("accepte un mandat via MandatesService.accept", async () => {
    const mandates = createFakeMandatesService();
    const service = new UssdAccountService(
      createFakePrisma() as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      mandates as any,
      createFakeSmsProvider() as any,
      createFakeOrganizationsService() as any,
    );

    await service.acceptMandate(ORG_ID, MANDATE_ID, USER_ID);

    expect(mandates.accept).toHaveBeenCalledWith(ORG_ID, MANDATE_ID, USER_ID);
  });

  it("révoque un mandat via MandatesService.revokeAsOrganization", async () => {
    const mandates = createFakeMandatesService();
    const service = new UssdAccountService(
      createFakePrisma() as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      mandates as any,
      createFakeSmsProvider() as any,
      createFakeOrganizationsService() as any,
    );

    await service.revokeMandate(ORG_ID, MANDATE_ID, USER_ID);

    expect(mandates.revokeAsOrganization).toHaveBeenCalledWith(ORG_ID, MANDATE_ID, USER_ID);
  });
});

describe("UssdAccountService — inviter un proche (F3, 5.5, DAT §3.5)", () => {
  it("délègue à OrganizationsService.inviteMember avec le rôle viewer quand le demandeur est owner", async () => {
    const prisma = createFakePrisma();
    const organizationsService = createFakeOrganizationsService();
    const service = new UssdAccountService(
      prisma as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      createFakeMandatesService() as any,
      createFakeSmsProvider() as any,
      organizationsService as any,
    );

    await service.inviteViewer(ORG_ID, USER_ID, "+224655667788");

    expect(prisma.organizationMember.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, userId: USER_ID, revokedAt: null },
    });
    expect(organizationsService.inviteMember).toHaveBeenCalledWith(
      ORG_ID,
      { msisdn: "+224655667788", role: "viewer" },
      USER_ID,
    );
  });

  it("délègue également quand le demandeur est admin (pas seulement owner)", async () => {
    const prisma = createFakePrisma({ requesterMembership: { organizationId: ORG_ID, userId: USER_ID, role: "admin", revokedAt: null } });
    const organizationsService = createFakeOrganizationsService();
    const service = new UssdAccountService(
      prisma as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      createFakeMandatesService() as any,
      createFakeSmsProvider() as any,
      organizationsService as any,
    );

    await service.inviteViewer(ORG_ID, USER_ID, "+224655667788");

    expect(organizationsService.inviteMember).toHaveBeenCalled();
  });

  it("refuse si le demandeur n'est ni owner ni admin — RolesGuard ne protège jamais ce chemin USSD", async () => {
    const prisma = createFakePrisma({ requesterMembership: { organizationId: ORG_ID, userId: USER_ID, role: "cashier", revokedAt: null } });
    const organizationsService = createFakeOrganizationsService();
    const service = new UssdAccountService(
      prisma as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      createFakeMandatesService() as any,
      createFakeSmsProvider() as any,
      organizationsService as any,
    );

    await expect(service.inviteViewer(ORG_ID, USER_ID, "+224655667788")).rejects.toThrow(ForbiddenException);
    expect(organizationsService.inviteMember).not.toHaveBeenCalled();
  });

  it("refuse si le demandeur n'a aucune membership active dans l'organisation", async () => {
    const prisma = createFakePrisma({ requesterMembership: null });
    const organizationsService = createFakeOrganizationsService();
    const service = new UssdAccountService(
      prisma as any,
      createFakeUssdAuth() as any,
      createFakeVelocityTier() as any,
      createFakeMandatesService() as any,
      createFakeSmsProvider() as any,
      organizationsService as any,
    );

    await expect(service.inviteViewer(ORG_ID, USER_ID, "+224655667788")).rejects.toThrow(ForbiddenException);
    expect(organizationsService.inviteMember).not.toHaveBeenCalled();
  });
});
