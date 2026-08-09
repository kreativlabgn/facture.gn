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
