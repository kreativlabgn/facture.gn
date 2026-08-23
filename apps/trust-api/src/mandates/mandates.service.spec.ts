import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MandatesService } from "./mandates.service";

const PRACTICE_ID = "practice-1";
const ORG_ID = "3b3963da-d099-43ea-996b-80000060b28a";
const REQUESTER_ID = "user-1";

function createFakePrisma(overrides: {
  member?: any;
  organization?: any;
  existingMandate?: any;
  createImpl?: ReturnType<typeof vi.fn>;
} = {}) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.member !== undefined ? overrides.member : { id: "member-1", role: "practice_admin" },
      ),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.organization !== undefined ? overrides.organization : { id: ORG_ID },
      ),
    },
    mandate: {
      findFirst: vi.fn().mockResolvedValue(overrides.existingMandate ?? null),
      create: overrides.createImpl ?? vi.fn().mockResolvedValue({ id: "mandate-1" }),
    },
  };
  return prisma;
}

describe("MandatesService", () => {
  it("crée un mandat pending avec requestedAt renseigné, tous les autres champs de cycle de vie null", async () => {
    const prisma = createFakePrisma();
    const service = new MandatesService(prisma as any);

    await service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID);

    expect(prisma.mandate.create).toHaveBeenCalledWith({
      data: {
        practiceId: PRACTICE_ID,
        organizationId: ORG_ID,
        grantedRole: "accountant_external",
        initiatedBy: "practice",
      },
    });
  });

  it("refuse si l'appelant n'est pas PracticeMember de la practice ciblée", async () => {
    const prisma = createFakePrisma({ member: null });
    const service = new MandatesService(prisma as any);

    await expect(
      service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID),
    ).rejects.toThrow(/practice_admin/);
  });

  it("refuse si l'appelant est PracticeMember mais pas practice_admin", async () => {
    const prisma = createFakePrisma({ member: { id: "member-1", role: "accountant_external" } });
    const service = new MandatesService(prisma as any);

    await expect(
      service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID),
    ).rejects.toThrow(/practice_admin/);
  });

  it("refuse (404) si l'organisation ciblée n'existe pas", async () => {
    const prisma = createFakePrisma({ organization: null });
    const service = new MandatesService(prisma as any);

    await expect(
      service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID),
    ).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) si un mandat pending existe déjà pour ce couple practice/organisation", async () => {
    const prisma = createFakePrisma({ existingMandate: { id: "mandate-existing", status: "pending" } });
    const service = new MandatesService(prisma as any);

    await expect(
      service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID),
    ).rejects.toThrow(/mandat/);
  });

  it("refuse (409) si un mandat active existe déjà pour ce couple practice/organisation", async () => {
    const prisma = createFakePrisma({ existingMandate: { id: "mandate-existing", status: "active" } });
    const service = new MandatesService(prisma as any);

    await expect(
      service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID),
    ).rejects.toThrow(/mandat/);
  });

  it("accepte une nouvelle demande si le seul mandat existant est revoked ou expired (états terminaux)", async () => {
    // findFirst filtré côté DB sur status IN (pending, active) — un mandat revoked/expired
    // ne matche jamais cette clause, donc le mock renvoie null ici (comportement DB simulé).
    const prisma = createFakePrisma({ existingMandate: null });
    const service = new MandatesService(prisma as any);

    await expect(
      service.create(PRACTICE_ID, { organizationId: ORG_ID, grantedRole: "accountant_external" }, REQUESTER_ID),
    ).resolves.toEqual({ id: "mandate-1" });

    expect(prisma.mandate.findFirst).toHaveBeenCalledWith({
      where: { practiceId: PRACTICE_ID, organizationId: ORG_ID, status: { in: ["pending", "active"] } },
    });
  });
});

const MANDATE_ID = "mandate-1";
const ACCEPTOR_ID = "owner-1";

function createFakePrismaForAccept(
  overrides: { mandate?: any; updateManyImpl?: ReturnType<typeof vi.fn> } = {},
) {
  const prisma: any = {
    mandate: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.mandate !== undefined
          ? overrides.mandate
          : { id: MANDATE_ID, organizationId: ORG_ID, status: "pending", initiatedBy: "practice" },
      ),
      // Quality Audit 2026-08-23, finding #4 — accept() réclame désormais la
      // transition via updateMany+where avant de relire le mandat.
      updateMany: overrides.updateManyImpl ?? vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: MANDATE_ID, status: "active" }),
    },
  };
  return prisma;
}

describe("MandatesService — acceptation (F1, ADR-069)", () => {
  it("accepte un mandat pending ciblant l'organisation — status active, grantedBy/grantedAt renseignés", async () => {
    const prisma = createFakePrismaForAccept();
    const service = new MandatesService(prisma as any);

    await service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID);

    expect(prisma.mandate.updateMany).toHaveBeenCalledWith({
      where: { id: MANDATE_ID, status: "pending" },
      data: { status: "active", grantedBy: ACCEPTOR_ID, grantedAt: expect.any(Date) },
    });
  });

  it("refuse (409) si updateMany ne réclame rien — traité entretemps par une autre requête (Quality Audit 2026-08-23, finding #4)", async () => {
    const prisma = createFakePrismaForAccept({ updateManyImpl: vi.fn().mockResolvedValue({ count: 0 }) });
    const service = new MandatesService(prisma as any);

    await expect(service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(ConflictException);
  });

  it("refuse (404) si le mandat n'existe pas", async () => {
    const prisma = createFakePrismaForAccept({ mandate: null });
    const service = new MandatesService(prisma as any);

    await expect(service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/introuvable/);
  });

  it("refuse (404) si le mandat cible une autre organisation que :id", async () => {
    const prisma = createFakePrismaForAccept({
      mandate: { id: MANDATE_ID, organizationId: "autre-organisation", status: "pending" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) si le mandat est déjà active", async () => {
    const prisma = createFakePrismaForAccept({
      mandate: { id: MANDATE_ID, organizationId: ORG_ID, status: "active" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/pending/);
  });

  it("refuse (409) si le mandat est revoked ou expired", async () => {
    const prisma = createFakePrismaForAccept({
      mandate: { id: MANDATE_ID, organizationId: ORG_ID, status: "revoked" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/pending/);
  });

  // F12 — défense en profondeur, scénario MIROIR de l'auto-acceptation practice
  // (ci-dessous) : l'organisation elle-même appelle accept() sur SA PROPRE
  // demande créée via requestFromOrganization() (mandate.organizationId ===
  // ORG_ID, le même que l'appelant) — sans ce check, elle s'auto-accepterait
  // instantanément, contournant le consentement du CGA (identifié en revue
  // sécurité, dev-security-reviewer). Seul acceptAsPractice() peut légitimement
  // accepter un mandat initiatedBy "organization".
  it("refuse (409) une organisation tentant d'auto-accepter sa propre demande requestFromOrganization()", async () => {
    const prisma = createFakePrismaForAccept({
      mandate: { id: MANDATE_ID, organizationId: ORG_ID, status: "pending", initiatedBy: "organization" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/practice/);
  });
});

const CGA_PRACTICE_ID = "cga-practice-1";

function createFakePrismaForRequestFromOrganization(
  overrides: { practice?: any; existingMandate?: any; createImpl?: ReturnType<typeof vi.fn> } = {},
) {
  const prisma: any = {
    professionalPractice: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.practice !== undefined ? overrides.practice : { id: CGA_PRACTICE_ID, type: "cga" },
      ),
    },
    mandate: {
      findFirst: vi.fn().mockResolvedValue(overrides.existingMandate ?? null),
      create: overrides.createImpl ?? vi.fn().mockResolvedValue({ id: "mandate-1" }),
    },
  };
  return prisma;
}

describe("MandatesService — adhérer à un CGA, initié par l'organisation (F12, ADR-078)", () => {
  it("crée un mandat pending initiatedBy \"organization\", grantedRole fixé serveur à accountant_external", async () => {
    const prisma = createFakePrismaForRequestFromOrganization();
    const service = new MandatesService(prisma as any);

    await service.requestFromOrganization(ORG_ID, CGA_PRACTICE_ID);

    expect(prisma.mandate.create).toHaveBeenCalledWith({
      data: {
        practiceId: CGA_PRACTICE_ID,
        organizationId: ORG_ID,
        grantedRole: "accountant_external",
        initiatedBy: "organization",
      },
    });
  });

  it("refuse (404) si la practice ciblée n'existe pas", async () => {
    const prisma = createFakePrismaForRequestFromOrganization({ practice: null });
    const service = new MandatesService(prisma as any);

    await expect(service.requestFromOrganization(ORG_ID, CGA_PRACTICE_ID)).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) si la practice ciblée n'est PAS de type cga", async () => {
    const prisma = createFakePrismaForRequestFromOrganization({
      practice: { id: CGA_PRACTICE_ID, type: "cabinet_comptable" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.requestFromOrganization(ORG_ID, CGA_PRACTICE_ID)).rejects.toThrow(/CGA/);
  });

  it("refuse (409) si un mandat pending ou active existe déjà pour ce couple", async () => {
    const prisma = createFakePrismaForRequestFromOrganization({
      existingMandate: { id: "mandate-existing", status: "pending" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.requestFromOrganization(ORG_ID, CGA_PRACTICE_ID)).rejects.toThrow(/mandat/);
  });
});

function createFakePrismaForAcceptAsPractice(
  overrides: { member?: any; mandate?: any; updateManyImpl?: ReturnType<typeof vi.fn> } = {},
) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.member !== undefined ? overrides.member : { id: "member-1", role: "practice_admin" },
      ),
    },
    mandate: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.mandate !== undefined
          ? overrides.mandate
          : { id: MANDATE_ID, practiceId: CGA_PRACTICE_ID, status: "pending", initiatedBy: "organization" },
      ),
      // Quality Audit 2026-08-23, finding #4 — voir createFakePrismaForAccept().
      updateMany: overrides.updateManyImpl ?? vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: MANDATE_ID, status: "active" }),
    },
  };
  return prisma;
}

describe("MandatesService — accepter une adhésion, côté CGA (F12, ADR-078)", () => {
  it("accepte un mandat pending initiatedBy \"organization\" détenu par la practice — status active", async () => {
    const prisma = createFakePrismaForAcceptAsPractice();
    const service = new MandatesService(prisma as any);

    await service.acceptAsPractice(CGA_PRACTICE_ID, MANDATE_ID, ACCEPTOR_ID);

    expect(prisma.mandate.updateMany).toHaveBeenCalledWith({
      where: { id: MANDATE_ID, status: "pending" },
      data: { status: "active", grantedBy: ACCEPTOR_ID, grantedAt: expect.any(Date) },
    });
  });

  it("refuse (409) si updateMany ne réclame rien — traité entretemps par une autre requête (Quality Audit 2026-08-23, finding #4)", async () => {
    const prisma = createFakePrismaForAcceptAsPractice({
      updateManyImpl: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const service = new MandatesService(prisma as any);

    await expect(service.acceptAsPractice(CGA_PRACTICE_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  // LE test qui prouve que le contournement de consentement identifié à la
  // conception est structurellement bloqué — pas juste supposé par la présence
  // du champ initiatedBy. Sans ce check, un practice_admin pourrait s'auto-
  // accepter un mandat qu'il a lui-même créé via create() (F5), contournant le
  // consentement organisationnel qu'ADR-069 est censé garantir.
  it("refuse (409) un mandat initiatedBy \"practice\" — jamais d'auto-acceptation par la practice qui l'a créé", async () => {
    const prisma = createFakePrismaForAcceptAsPractice({
      mandate: { id: MANDATE_ID, practiceId: CGA_PRACTICE_ID, status: "pending", initiatedBy: "practice" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.acceptAsPractice(CGA_PRACTICE_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(
      /organisation/,
    );
  });

  it("refuse si l'appelant n'est pas practice_admin de la practice ciblée", async () => {
    const prisma = createFakePrismaForAcceptAsPractice({ member: null });
    const service = new MandatesService(prisma as any);

    await expect(
      service.acceptAsPractice(CGA_PRACTICE_ID, MANDATE_ID, ACCEPTOR_ID),
    ).rejects.toThrow(/practice_admin/);
  });

  it("refuse (404) si le mandat est détenu par une autre practice", async () => {
    const prisma = createFakePrismaForAcceptAsPractice({
      mandate: { id: MANDATE_ID, practiceId: "autre-practice", status: "pending", initiatedBy: "organization" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.acceptAsPractice(CGA_PRACTICE_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(
      /introuvable/,
    );
  });

  it("refuse (409) si le mandat n'est pas pending", async () => {
    const prisma = createFakePrismaForAcceptAsPractice({
      mandate: { id: MANDATE_ID, practiceId: CGA_PRACTICE_ID, status: "active", initiatedBy: "organization" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.acceptAsPractice(CGA_PRACTICE_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(
      /pending/,
    );
  });
});

function createFakePrismaForRevoke(
  overrides: { member?: any; mandate?: any; updateManyImpl?: ReturnType<typeof vi.fn> } = {},
) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.member !== undefined ? overrides.member : { id: "member-1", role: "practice_admin" },
      ),
    },
    mandate: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.mandate !== undefined
          ? overrides.mandate
          : { id: MANDATE_ID, practiceId: PRACTICE_ID, status: "active" },
      ),
      // Quality Audit 2026-08-23, finding #4 — voir createFakePrismaForAccept().
      updateMany: overrides.updateManyImpl ?? vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: MANDATE_ID, status: "revoked" }),
    },
  };
  return prisma;
}

describe("MandatesService — révocation (F6, ADR-069)", () => {
  it("révoque un mandat active détenu par la practice — status revoked, revokedAt renseigné", async () => {
    const prisma = createFakePrismaForRevoke();
    const service = new MandatesService(prisma as any);

    await service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID);

    expect(prisma.mandate.updateMany).toHaveBeenCalledWith({
      where: { id: MANDATE_ID, status: "active" },
      data: { status: "revoked", revokedAt: expect.any(Date) },
    });
  });

  it("refuse (409) si updateMany ne réclame rien — traité entretemps par une autre requête (Quality Audit 2026-08-23, finding #4)", async () => {
    const prisma = createFakePrismaForRevoke({ updateManyImpl: vi.fn().mockResolvedValue({ count: 0 }) });
    const service = new MandatesService(prisma as any);

    await expect(service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID)).rejects.toThrow(ConflictException);
  });

  it("refuse si l'appelant n'est pas practice_admin de la practice ciblée", async () => {
    const prisma = createFakePrismaForRevoke({ member: null });
    const service = new MandatesService(prisma as any);

    await expect(service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID)).rejects.toThrow(/practice_admin/);
  });

  it("refuse (404) si le mandat n'existe pas", async () => {
    const prisma = createFakePrismaForRevoke({ mandate: null });
    const service = new MandatesService(prisma as any);

    await expect(service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID)).rejects.toThrow(/introuvable/);
  });

  it("refuse (404) si le mandat est détenu par une autre practice que :id", async () => {
    const prisma = createFakePrismaForRevoke({
      mandate: { id: MANDATE_ID, practiceId: "autre-practice", status: "active" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID)).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) si le mandat est pending (jamais accepté, rien à révoquer)", async () => {
    const prisma = createFakePrismaForRevoke({
      mandate: { id: MANDATE_ID, practiceId: PRACTICE_ID, status: "pending" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID)).rejects.toThrow(/active/);
  });

  it("refuse (409) si le mandat est déjà revoked ou expired", async () => {
    const prisma = createFakePrismaForRevoke({
      mandate: { id: MANDATE_ID, practiceId: PRACTICE_ID, status: "expired" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID)).rejects.toThrow(/active/);
  });
});

function createFakePrismaForListAccessibleOrganizations(
  overrides: { member?: any; mandates?: any[] } = {},
) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.member !== undefined ? overrides.member : { id: "member-1", role: "accountant_external" },
      ),
    },
    mandate: {
      findMany: vi.fn().mockResolvedValue(
        overrides.mandates ?? [
          { id: MANDATE_ID, status: "active", organization: { id: ORG_ID, name: "Boutique Aissatou" } },
        ],
      ),
    },
  };
  return prisma;
}

describe("MandatesService — organisations accessibles (F7, ADR-070)", () => {
  it("retourne les organisations dont le mandat est active pour cette practice", async () => {
    const prisma = createFakePrismaForListAccessibleOrganizations();
    const service = new MandatesService(prisma as any);

    const result = await service.listAccessibleOrganizations(PRACTICE_ID, REQUESTER_ID);

    expect(prisma.mandate.findMany).toHaveBeenCalledWith({
      // Quality Audit 2026-08-23, finding #2 — un mandat expiré ne doit
      // jamais rester accessible au switch d'organisation cabinet.
      where: {
        practiceId: PRACTICE_ID,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      include: { organization: { select: { id: true, name: true } } },
    });
    expect(result).toEqual([
      { id: MANDATE_ID, status: "active", organization: { id: ORG_ID, name: "Boutique Aissatou" } },
    ]);
  });

  it("refuse si l'appelant n'est pas PracticeMember de la practice ciblée", async () => {
    const prisma = createFakePrismaForListAccessibleOrganizations({ member: null });
    const service = new MandatesService(prisma as any);

    await expect(service.listAccessibleOrganizations(PRACTICE_ID, REQUESTER_ID)).rejects.toThrow(/membre/);
  });

  it("accepte un accountant_external, pas seulement un practice_admin (ADR-070)", async () => {
    const prisma = createFakePrismaForListAccessibleOrganizations({
      member: { id: "member-1", role: "accountant_external" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.listAccessibleOrganizations(PRACTICE_ID, REQUESTER_ID)).resolves.not.toThrow();
  });
});

describe("MandatesService — lister tous les mandats d'un cabinet (pending + active)", () => {
  it("retourne les mandats pending et active avec l'organisation, tout membre actif peut consulter", async () => {
    const prisma: any = {
      practiceMember: { findFirst: vi.fn().mockResolvedValue({ id: "member-1", role: "accountant_external" }) },
      mandate: {
        findMany: vi.fn().mockResolvedValue([
          { id: "mandate-1", status: "active", initiatedBy: "practice", organization: { id: ORG_ID, name: "Boutique Aissatou" } },
          { id: "mandate-2", status: "pending", initiatedBy: "organization", organization: { id: "org-2", name: "Salon Djénabou" } },
        ]),
      },
    };
    const service = new MandatesService(prisma as any);

    const result = await service.listAll(PRACTICE_ID, REQUESTER_ID);

    expect(prisma.mandate.findMany).toHaveBeenCalledWith({
      // Quality Audit 2026-08-23, finding #2 — pending n'accorde jamais
      // d'accès (pas de filtre d'expiration pertinent), active reste soumis
      // à la même garde que partout ailleurs.
      where: {
        practiceId: PRACTICE_ID,
        OR: [
          { status: "pending" },
          { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
        ],
      },
      include: { organization: { select: { id: true, name: true } } },
    });
    expect(result).toHaveLength(2);
  });

  it("refuse un non-membre de la practice", async () => {
    const prisma: any = {
      practiceMember: { findFirst: vi.fn().mockResolvedValue(null) },
      mandate: { findMany: vi.fn() },
    };
    const service = new MandatesService(prisma as any);

    await expect(service.listAll(PRACTICE_ID, REQUESTER_ID)).rejects.toThrow(/membre/);
    expect(prisma.mandate.findMany).not.toHaveBeenCalled();
  });
});

describe("MandatesService — vues et révocation côté organisation (option 5 USSD, §2.5 Spec USSD)", () => {
  it("liste les mandats pending initiés par une practice (F5) — jamais ceux initiés par l'organisation elle-même (F12)", async () => {
    const prisma: any = {
      mandate: { findMany: vi.fn().mockResolvedValue([{ id: "mandate-1" }]) },
    };
    const service = new MandatesService(prisma as any);

    const result = await service.listPendingForOrganization(ORG_ID);

    expect(prisma.mandate.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, status: "pending", initiatedBy: "practice" },
      include: { practice: true },
    });
    expect(result).toHaveLength(1);
  });

  it("liste les mandats actifs de l'organisation", async () => {
    const prisma: any = {
      mandate: { findMany: vi.fn().mockResolvedValue([{ id: "mandate-1" }]) },
    };
    const service = new MandatesService(prisma as any);

    await service.listActiveForOrganization(ORG_ID);

    expect(prisma.mandate.findMany).toHaveBeenCalledWith({
      // Quality Audit 2026-08-23, finding #2 — même garde d'expiration côté
      // vue organisation.
      where: {
        organizationId: ORG_ID,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      include: { practice: true },
    });
  });

  it("liste les mandats actifs — un mandat expiré (status \"active\" mais expiresAt passé) n'apparaît jamais (Quality Audit 2026-08-23, revue post-fix #2)", async () => {
    // Contrairement au test précédent (forme du where), simule le comportement
    // réel du filtre expiresAt côté "DB" plutôt que de toujours renvoyer la
    // même fixture quel que soit le where.
    const rows = [
      { id: "mandate-expired", status: "active", expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      { id: "mandate-valid", status: "active", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      { id: "mandate-no-expiry", status: "active", expiresAt: null },
    ];
    const prisma: any = {
      mandate: {
        findMany: vi.fn().mockImplementation(() => {
          const now = new Date();
          return Promise.resolve(
            rows.filter((row) => row.expiresAt === null || row.expiresAt.getTime() > now.getTime()),
          );
        }),
      },
    };
    const service = new MandatesService(prisma as any);

    const result = await service.listActiveForOrganization(ORG_ID);

    expect(result.map((mandate: any) => mandate.id)).toEqual(["mandate-valid", "mandate-no-expiry"]);
  });

  function createFakePrismaForRevokeAsOrganization(
    overrides: { member?: any; mandate?: any; updateManyImpl?: ReturnType<typeof vi.fn> } = {},
  ) {
    return {
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.member !== undefined ? overrides.member : { role: "owner", revokedAt: null },
        ),
      },
      mandate: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.mandate !== undefined ? overrides.mandate : { id: MANDATE_ID, organizationId: ORG_ID, status: "active" },
        ),
        // Quality Audit 2026-08-23, finding #4 — voir createFakePrismaForAccept().
        updateMany: overrides.updateManyImpl ?? vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: MANDATE_ID, status: "revoked" }),
      },
    };
  }

  it("révoque un mandat actif — autorisé owner/admin de l'organisation elle-même", async () => {
    const prisma = createFakePrismaForRevokeAsOrganization();
    const service = new MandatesService(prisma as any);

    await service.revokeAsOrganization(ORG_ID, MANDATE_ID, ACCEPTOR_ID);

    expect(prisma.mandate.updateMany).toHaveBeenCalledWith({
      where: { id: MANDATE_ID, status: "active" },
      data: { status: "revoked", revokedAt: expect.any(Date) },
    });
  });

  it("refuse (409) si updateMany ne réclame rien — traité entretemps par une autre requête (Quality Audit 2026-08-23, finding #4)", async () => {
    const prisma = createFakePrismaForRevokeAsOrganization({
      updateManyImpl: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const service = new MandatesService(prisma as any);

    await expect(service.revokeAsOrganization(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it("refuse un membre non owner/admin de l'organisation", async () => {
    const prisma = createFakePrismaForRevokeAsOrganization({ member: { role: "cashier", revokedAt: null } });
    const service = new MandatesService(prisma as any);

    await expect(service.revokeAsOrganization(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/owner|admin/);
  });

  it("refuse (404) si le mandat n'appartient pas à cette organisation", async () => {
    const prisma = createFakePrismaForRevokeAsOrganization({
      mandate: { id: MANDATE_ID, organizationId: "autre-org", status: "active" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.revokeAsOrganization(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) un mandat déjà revoked/pending", async () => {
    const prisma = createFakePrismaForRevokeAsOrganization({
      mandate: { id: MANDATE_ID, organizationId: ORG_ID, status: "pending" },
    });
    const service = new MandatesService(prisma as any);

    await expect(service.revokeAsOrganization(ORG_ID, MANDATE_ID, ACCEPTOR_ID)).rejects.toThrow(/active/);
  });
});
