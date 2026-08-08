import { describe, expect, it, vi } from "vitest";
import { InvoicesService } from "./invoices.service";

function createFakePrisma(overrides: { invoice?: any; organization?: any } = {}) {
  return {
    invoice: {
      create: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft" }),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
      ...overrides.invoice,
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", nif: "GN12345678" }),
      ...overrides.organization,
    },
  };
}

function createFakeNumbering(number = "FG-2026-000001") {
  return { nextNumber: vi.fn().mockResolvedValue(number) };
}

function createFakeCertification() {
  return {
    certify: vi.fn().mockReturnValue({
      hash: "a".repeat(64),
      previousHash: "GENESIS",
      certificationId: "GN-GN123456-2026-ABCDEF",
      signature: "b".repeat(128),
    }),
    verify: vi.fn().mockReturnValue(true),
  };
}

describe("InvoicesService — immutabilité post-émission", () => {
  it("refuse toute mutation directe d'une facture issued — seul un avoir peut corriger", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(prisma as any, createFakeNumbering() as any, createFakeCertification() as any);

    await expect(service.updateDraft("inv-1", { totalTtc: 999n })).rejects.toThrow(/immuable/);
  });

  it("autorise la mutation d'une facture encore draft", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(prisma as any, createFakeNumbering() as any, createFakeCertification() as any);

    await service.updateDraft("inv-1", { totalTtc: 999n });

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { totalTtc: 999n },
    });
  });
});

describe("InvoicesService — machine à états", () => {
  it("autorise draft → issued et certifie la facture (chaînage GENESIS pour la 1ère facture de l'org)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
    });
    const numbering = createFakeNumbering();
    const certification = createFakeCertification();
    const service = new InvoicesService(prisma as any, numbering as any, certification as any);

    const result = await service.issue("inv-1");

    expect(numbering.nextNumber).toHaveBeenCalledWith("org-1", expect.any(Number));
    expect(certification.certify).toHaveBeenCalledWith(
      expect.objectContaining({ previousHash: "GENESIS" }),
    );
    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
  });

  it("refuse d'émettre (issued) une facture qui n'est pas draft", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued" }),
      },
    });
    const service = new InvoicesService(prisma as any, createFakeNumbering() as any, createFakeCertification() as any);

    await expect(service.issue("inv-1")).rejects.toThrow(/statut/);
  });

  it("annule (voided) une facture draft sans paiement", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(prisma as any, createFakeNumbering() as any, createFakeCertification() as any);

    const result = await service.void("inv-1");

    expect(result.status).toBe("voided");
  });

  it("refuse d'annuler une facture ayant déjà un paiement enregistré", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued", amountPaid: 500_000n }),
      },
    });
    const service = new InvoicesService(prisma as any, createFakeNumbering() as any, createFakeCertification() as any);

    await expect(service.void("inv-1")).rejects.toThrow(/avoir/);
  });

  it("traduit une violation de contrainte unique sur (organization_id, number) en erreur explicite, jamais un 500 brut", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["organization_id", "number"] },
    });
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
        update: vi.fn().mockRejectedValue(uniqueViolation),
      },
    });
    const service = new InvoicesService(prisma as any, createFakeNumbering() as any, createFakeCertification() as any);

    await expect(service.issue("inv-1")).rejects.toThrow(/numéro/);
  });
});
