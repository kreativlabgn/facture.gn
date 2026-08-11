import { describe, expect, it, vi } from "vitest";
import { PracticesService } from "./practices.service";

function createFakePrisma(createImpl?: ReturnType<typeof vi.fn>) {
  const prisma: any = {
    professionalPractice: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "practice-1" }),
    },
    practiceMember: {
      create: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

describe("PracticesService", () => {
  it("crée une practice avec les champs fournis, type persisté tel quel", async () => {
    const prisma = createFakePrisma();
    const service = new PracticesService(prisma as any);

    await service.create(
      { name: "Cabinet Mamadou & Associés", type: "cabinet_comptable", phone: "+224612345678" },
      "user-1",
    );

    expect(prisma.professionalPractice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Cabinet Mamadou & Associés", type: "cabinet_comptable" }),
    });
  });

  it("le créateur devient automatiquement practice_admin de la nouvelle practice", async () => {
    const prisma = createFakePrisma();
    const service = new PracticesService(prisma as any);

    await service.create(
      { name: "Cabinet Mamadou & Associés", type: "cabinet_comptable", phone: "+224612345678" },
      "user-1",
    );

    expect(prisma.practiceMember.create).toHaveBeenCalledWith({
      data: { practiceId: "practice-1", userId: "user-1", role: "practice_admin" },
    });
  });

  it("registrationNumber et email absents → null, jamais un défaut serveur inventé", async () => {
    const prisma = createFakePrisma();
    const service = new PracticesService(prisma as any);

    await service.create({ name: "CGA Kaloum", type: "cga", phone: "+224612345678" }, "user-1");

    expect(prisma.professionalPractice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ registrationNumber: undefined, email: undefined }),
    });
  });
});

const PRACTICE_ID = "practice-1";
const ADMIN_ID = "admin-1";
const INVITED_MSISDN = "+224612345678";

function createFakePrismaForInviteMember(
  overrides: { requesterMember?: any; userPhone?: any; existingMembership?: any } = {},
) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        // Distingue l'appel "vérifie que le demandeur est practice_admin" du
        // 2e appel "vérifie si l'invité est déjà membre" via userId.
        if (where.userId === ADMIN_ID) {
          return Promise.resolve(
            overrides.requesterMember !== undefined
              ? overrides.requesterMember
              : { id: "member-admin", role: "practice_admin" },
          );
        }
        return Promise.resolve(overrides.existingMembership ?? null);
      }),
      create: vi.fn().mockResolvedValue({ id: "member-2", role: "accountant_external" }),
    },
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.userPhone !== undefined ? overrides.userPhone : { userId: "invited-1", msisdn: INVITED_MSISDN },
      ),
    },
  };
  return prisma;
}

describe("PracticesService — inviter un collaborateur (F8, ADR-068)", () => {
  it("ajoute un collaborateur déjà inscrit avec role accountant_external", async () => {
    const prisma = createFakePrismaForInviteMember();
    const service = new PracticesService(prisma as any);

    await service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID);

    expect(prisma.practiceMember.create).toHaveBeenCalledWith({
      data: { practiceId: PRACTICE_ID, userId: "invited-1", role: "accountant_external" },
    });
  });

  it("refuse si l'appelant n'est pas practice_admin de la practice ciblée", async () => {
    const prisma = createFakePrismaForInviteMember({ requesterMember: null });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).rejects.toThrow(/practice_admin/);
  });

  it("refuse (404) si le msisdn n'est associé à aucun compte", async () => {
    const prisma = createFakePrismaForInviteMember({ userPhone: null });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) si l'utilisateur est déjà membre actif de cette practice", async () => {
    const prisma = createFakePrismaForInviteMember({
      existingMembership: { id: "member-existing", userId: "invited-1", leftAt: null },
    });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).rejects.toThrow(/déjà membre/);
  });

  it("accepte un ré-ajout si le seul membership existant a leftAt renseigné", async () => {
    const prisma = createFakePrismaForInviteMember({ existingMembership: null });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).resolves.toEqual({ id: "member-2", role: "accountant_external" });
  });
});

describe("PracticesService — lister les practices dont je suis membre", () => {
  it("retourne les practices dont l'utilisateur est membre actif, avec son rôle sur chacune", async () => {
    const prisma: any = {
      practiceMember: {
        findMany: vi.fn().mockResolvedValue([
          { role: "practice_admin", practice: { id: "practice-1", name: "Cabinet Mamadou & Associés", type: "cabinet_comptable" } },
          { role: "accountant_external", practice: { id: "practice-2", name: "CGA Kaloum", type: "cga" } },
        ]),
      },
    };
    const service = new PracticesService(prisma as any);

    const result = await service.listMine("user-1");

    expect(prisma.practiceMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", leftAt: null },
      include: { practice: true },
    });
    expect(result).toEqual([
      { id: "practice-1", name: "Cabinet Mamadou & Associés", type: "cabinet_comptable", role: "practice_admin" },
      { id: "practice-2", name: "CGA Kaloum", type: "cga", role: "accountant_external" },
    ]);
  });

  it("ne retourne jamais un membership quitté (leftAt renseigné) — filtré côté requête", async () => {
    const prisma: any = { practiceMember: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new PracticesService(prisma as any);

    const result = await service.listMine("user-1");

    expect(result).toEqual([]);
    expect(prisma.practiceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leftAt: null }) }),
    );
  });
});

describe("PracticesService — lister par type (F12, ADR-078)", () => {
  it("liste les practices du type demandé", async () => {
    const prisma: any = {
      professionalPractice: {
        findMany: vi.fn().mockResolvedValue([{ id: "cga-1", type: "cga", name: "CGA Kaloum" }]),
      },
    };
    const service = new PracticesService(prisma as any);

    const result = await service.findAllByType("cga");

    expect(prisma.professionalPractice.findMany).toHaveBeenCalledWith({ where: { type: "cga" } });
    expect(result).toEqual([{ id: "cga-1", type: "cga", name: "CGA Kaloum" }]);
  });
});
