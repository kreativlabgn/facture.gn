import { describe, expect, it, vi } from "vitest";
import { OrganizationAccessService } from "./organization-access.service";

const ORG_ID = "org-1";
const USER_ID = "user-1";
const ELIGIBLE_ROLES = ["owner", "admin", "accountant_internal"] as const;

function createFakePrisma(overrides: { member?: any; mandate?: any } = {}) {
  return {
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue(overrides.member ?? null),
    },
    mandate: {
      findFirst: vi.fn().mockResolvedValue(overrides.mandate ?? null),
    },
  };
}

describe("OrganizationAccessService — accès par membership OU mandat actif", () => {
  it("autorise un membre avec un rôle éligible", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).resolves.toBeUndefined();
  });

  it("n'interroge jamais Mandate quand OrganizationMember autorise déjà", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new OrganizationAccessService(prisma as any);

    await service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES]);

    expect(prisma.mandate.findFirst).not.toHaveBeenCalled();
  });

  it("autorise un PracticeMember dont la practice détient un mandat actif sur l'organisation", async () => {
    const prisma = createFakePrisma({ member: null, mandate: { id: "mandate-1", status: "active" } });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).resolves.toBeUndefined();
    expect(prisma.mandate.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        status: "active",
        // Quality Audit 2026-08-23, finding #2 — un mandat expiré (expiresAt
        // dans le passé) ne doit jamais accorder d'accès, même si status est
        // encore "active" faute de cron de purge.
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        practice: { members: { some: { userId: USER_ID, leftAt: null } } },
      },
    });
  });

  it("refuse un utilisateur sans OrganizationMember ni mandat actif", async () => {
    const prisma = createFakePrisma({ member: null, mandate: null });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).rejects.toThrow(/accès/);
  });

  it("refuse un OrganizationMember révoqué (revokedAt renseigné)", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: new Date() }, mandate: null });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).rejects.toThrow(/accès/);
  });

  it("refuse un membre dont le rôle n'est pas dans la liste éligible de l'appelant", async () => {
    const prisma = createFakePrisma({ member: { role: "cashier", revokedAt: null }, mandate: null });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).rejects.toThrow(/accès/);
  });
});

describe("OrganizationAccessService — Mandate.expiresAt réellement appliqué (Quality Audit 2026-08-23, revue post-fix #2)", () => {
  // Contrairement aux tests ci-dessus (qui n'inspectent que la FORME du where
  // passé au mock), ce mock simule le comportement réel de Postgres pour le
  // filtre expiresAt : un mandat status:"active" mais expiré n'est jamais
  // renvoyé, même si aucun cron de purge n'a encore mis à jour son status.
  function createFakePrismaWithRealExpirationFilter(mandate: { status: string; expiresAt: Date | null } | null) {
    return {
      organizationMember: { findUnique: vi.fn().mockResolvedValue(null) },
      mandate: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (!mandate) return Promise.resolve(null);
          if (where.status !== mandate.status) return Promise.resolve(null);
          const now = new Date();
          const notExpired =
            mandate.expiresAt === null || mandate.expiresAt.getTime() > now.getTime();
          if (!notExpired) return Promise.resolve(null);
          return Promise.resolve({ id: "mandate-1", ...mandate });
        }),
      },
    };
  }

  it("refuse l'accès pour un mandat status:\"active\" mais expiresAt dans le passé", async () => {
    const prisma = createFakePrismaWithRealExpirationFilter({
      status: "active",
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).rejects.toThrow(/accès/);
  });

  it("autorise l'accès pour un mandat status:\"active\" avec expiresAt dans le futur", async () => {
    const prisma = createFakePrismaWithRealExpirationFilter({
      status: "active",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).resolves.toBeUndefined();
  });

  it("autorise l'accès pour un mandat status:\"active\" avec expiresAt: null (jamais d'expiration posée)", async () => {
    const prisma = createFakePrismaWithRealExpirationFilter({ status: "active", expiresAt: null });
    const service = new OrganizationAccessService(prisma as any);

    await expect(service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES])).resolves.toBeUndefined();
  });
});

describe("OrganizationAccessService — filtre optionnel requiredMandateGrantedRole (E7, ADR-084)", () => {
  it("autorise un mandat actif dont grantedRole correspond au filtre demandé", async () => {
    const prisma = createFakePrisma({ member: null, mandate: { id: "mandate-1", status: "active" } });
    const service = new OrganizationAccessService(prisma as any);

    await expect(
      service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES], "business_manager"),
    ).resolves.toBeUndefined();
    expect(prisma.mandate.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        practice: { members: { some: { userId: USER_ID, leftAt: null } } },
        grantedRole: "business_manager",
      },
    });
  });

  it("rejette un mandat actif dont grantedRole ne correspond PAS au filtre demandé (accountant_external ≠ business_manager)", async () => {
    // Le mock findFirst filtre lui-même côté "DB" — un mandat accountant_external
    // ne matche jamais un where incluant grantedRole: "business_manager".
    const prisma = createFakePrisma({ member: null, mandate: null });
    const service = new OrganizationAccessService(prisma as any);

    await expect(
      service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES], "business_manager"),
    ).rejects.toThrow(/accès/);
  });

  it("non-régression FEC : sans le paramètre, accepte tout mandat actif quel que soit grantedRole", async () => {
    const prisma = createFakePrisma({ member: null, mandate: { id: "mandate-1", status: "active" } });
    const service = new OrganizationAccessService(prisma as any);

    await service.assertAccess(ORG_ID, USER_ID, [...ELIGIBLE_ROLES]);

    expect(prisma.mandate.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        practice: { members: { some: { userId: USER_ID, leftAt: null } } },
      },
    });
  });
});
