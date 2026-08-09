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
      data: { practiceId: PRACTICE_ID, organizationId: ORG_ID, grantedRole: "accountant_external" },
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

function createFakePrismaForAccept(overrides: { mandate?: any; updateImpl?: ReturnType<typeof vi.fn> } = {}) {
  const prisma: any = {
    mandate: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.mandate !== undefined
          ? overrides.mandate
          : { id: MANDATE_ID, organizationId: ORG_ID, status: "pending" },
      ),
      update: overrides.updateImpl ?? vi.fn().mockResolvedValue({ id: MANDATE_ID, status: "active" }),
    },
  };
  return prisma;
}

describe("MandatesService — acceptation (F1, ADR-069)", () => {
  it("accepte un mandat pending ciblant l'organisation — status active, grantedBy/grantedAt renseignés", async () => {
    const prisma = createFakePrismaForAccept();
    const service = new MandatesService(prisma as any);

    await service.accept(ORG_ID, MANDATE_ID, ACCEPTOR_ID);

    expect(prisma.mandate.update).toHaveBeenCalledWith({
      where: { id: MANDATE_ID },
      data: { status: "active", grantedBy: ACCEPTOR_ID, grantedAt: expect.any(Date) },
    });
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
});

function createFakePrismaForRevoke(
  overrides: { member?: any; mandate?: any; updateImpl?: ReturnType<typeof vi.fn> } = {},
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
      update: overrides.updateImpl ?? vi.fn().mockResolvedValue({ id: MANDATE_ID, status: "revoked" }),
    },
  };
  return prisma;
}

describe("MandatesService — révocation (F6, ADR-069)", () => {
  it("révoque un mandat active détenu par la practice — status revoked, revokedAt renseigné", async () => {
    const prisma = createFakePrismaForRevoke();
    const service = new MandatesService(prisma as any);

    await service.revoke(PRACTICE_ID, MANDATE_ID, REQUESTER_ID);

    expect(prisma.mandate.update).toHaveBeenCalledWith({
      where: { id: MANDATE_ID },
      data: { status: "revoked", revokedAt: expect.any(Date) },
    });
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
      where: { practiceId: PRACTICE_ID, status: "active" },
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
