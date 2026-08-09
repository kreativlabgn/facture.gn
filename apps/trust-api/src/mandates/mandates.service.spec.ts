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
