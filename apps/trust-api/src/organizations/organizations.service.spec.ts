import { describe, expect, it, vi } from "vitest";
import { OrganizationsService } from "./organizations.service";

function createFakePrisma(createImpl?: ReturnType<typeof vi.fn>) {
  return {
    organization: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "org-1" }),
    },
  };
}

describe("OrganizationsService", () => {
  it("persiste le régime fiscal fourni par le client, jamais un défaut serveur", async () => {
    const prisma = createFakePrisma();
    const service = new OrganizationsService(prisma as any);

    await service.create({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      nif: "GN12345678",
    });

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ regimeFiscal: "tpu" }),
    });
  });

  it("traduit une violation de contrainte unique sur le NIF en erreur explicite", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["nif"] },
    });
    const prisma = createFakePrisma(vi.fn().mockRejectedValue(uniqueViolation));
    const service = new OrganizationsService(prisma as any);

    await expect(
      service.create({
        name: "Boutique Aissatou",
        regimeFiscal: "tpu",
        legalForm: "commercial",
        nif: "GN12345678",
      }),
    ).rejects.toThrow(/NIF/);
  });
});
