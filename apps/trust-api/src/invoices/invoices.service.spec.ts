import { describe, expect, it, vi } from "vitest";
import { InvoicesService } from "./invoices.service";

function createFakePrisma(overrides: { invoice?: any; organization?: any } = {}) {
  // update() cumulatif (comme le vrai Prisma, qui renvoie toujours la ligne complète,
  // pas seulement les champs patchés) — nécessaire car issue() peut faire deux
  // update() successifs (certification, puis lien de paiement en meilleur effort).
  let invoiceState: any = { id: "inv-1" };
  const seedFindUniqueOrThrow = overrides.invoice?.findUniqueOrThrow;

  return {
    invoice: {
      create: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft" }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }: any) => {
        invoiceState = { ...invoiceState, ...data };
        return Promise.resolve(invoiceState);
      }),
      ...overrides.invoice,
      // Toujours la version enveloppée, même si overrides en fournit une — sinon
      // invoiceState ne serait jamais initialisé et les update() suivants perdraient
      // les champs de la facture chargée au départ.
      findUniqueOrThrow: vi.fn().mockImplementation(async (...args: any[]) => {
        const result = seedFindUniqueOrThrow ? await seedFindUniqueOrThrow(...args) : invoiceState;
        invoiceState = { ...invoiceState, ...result };
        return result;
      }),
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

// null par défaut = comportement des tests préexistants (aucun lien de paiement
// généré) — reflète le cas le plus courant en test unitaire, la panne Money Context
// étant précisément ce que Test "réussit normalement" exerce explicitement.
function createFakePaymentLinkClient(result: any = null) {
  return { tryGenerate: vi.fn().mockResolvedValue(result) };
}

describe("InvoicesService — immutabilité post-émission", () => {
  it("refuse toute mutation directe d'une facture issued — seul un avoir peut corriger", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.updateDraft("inv-1", { totalTtc: 999n })).rejects.toThrow(/immuable/);
  });

  it("autorise la mutation d'une facture encore draft", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

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
    const service = new InvoicesService(
      prisma as any,
      numbering as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.issue("inv-1");

    expect(numbering.nextNumber).toHaveBeenCalledWith("org-1", expect.any(Number));
    expect(certification.certify).toHaveBeenCalledWith(
      expect.objectContaining({ previousHash: "GENESIS" }),
    );
    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
  });

  it("émet une facture pour une organisation sans NIF avec le placeholder de certification (B1/B4)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", nif: null }),
      },
    });
    const certification = createFakeCertification();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    await service.issue("inv-1");

    expect(certification.certify).toHaveBeenCalledWith(
      expect.objectContaining({ organizationNif: "UNVERIFI" }),
    );
  });

  it("refuse d'émettre (issued) une facture qui n'est pas draft", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued" }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1")).rejects.toThrow(/statut/);
  });

  it("annule (voided) une facture draft sans paiement", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.void("inv-1");

    expect(result.status).toBe("voided");
  });

  it("refuse d'annuler une facture ayant déjà un paiement enregistré", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued", amountPaid: 500_000n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

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
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1")).rejects.toThrow(/numéro/);
  });
});

describe("InvoicesService — lien de paiement à l'émission (C2 Phase 2a)", () => {
  const draftInvoice = {
    id: "inv-1",
    status: "draft",
    organizationId: "org-1",
    totalTtc: 1_500_000n,
  };
  const resolvedLink = {
    paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-stub-inv-1",
    providerRef: "djomy-stub-inv-1",
    expiresAt: new Date("2026-09-07T00:00:00.000Z"),
  };

  it("peuple paymentLinkUrl/paymentLinkId/paymentLinkExpiresAt quand la génération de lien réussit", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1");

    expect(paymentLinkClient.tryGenerate).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      organizationId: "org-1",
      amountGnf: 1_500_000n,
    });
    expect(result.paymentLinkUrl).toBe(resolvedLink.paymentLinkUrl);
    expect(result.paymentLinkId).toBe(resolvedLink.providerRef);
    expect(result.paymentLinkExpiresAt).toBe(resolvedLink.expiresAt);
  });

  it("réussit normalement (émission jamais bloquée) quand le second update() échoue — money-api a répondu un corps inattendu", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    // Simule un écrit refusé par Prisma (ex. paymentLinkExpiresAt invalide suite à un
    // corps de réponse money-api malformé) — le premier update() (certification)
    // réussit normalement, seul le second (lien) échoue.
    let callCount = 0;
    prisma.invoice.update = vi.fn().mockImplementation(({ data }: any) => {
      callCount += 1;
      if (callCount === 2) {
        return Promise.reject(new Error("Invalid `DateTime` provided"));
      }
      return Promise.resolve({ ...draftInvoice, ...data });
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1");

    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
    expect(result.paymentLinkUrl).toBeUndefined();
  });

  it("réussit normalement (émission jamais bloquée) quand la génération de lien échoue — Money Context en panne", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const paymentLinkClient = createFakePaymentLinkClient(null);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1");

    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
    expect(result.paymentLinkUrl).toBeUndefined();
  });

  it("certifie la facture strictement à l'identique, que le lien de paiement réussisse ou échoue", async () => {
    const certification = createFakeCertification();

    const prismaSucces = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const serviceSucces = new InvoicesService(
      prismaSucces as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient(resolvedLink) as any,
    );
    const resultSucces = await serviceSucces.issue("inv-1");

    const prismaEchec = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const serviceEchec = new InvoicesService(
      prismaEchec as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient(null) as any,
    );
    const resultEchec = await serviceEchec.issue("inv-1");

    expect(resultSucces.number).toBe(resultEchec.number);
    expect(resultSucces.certificationId).toBe(resultEchec.certificationId);
    expect(resultSucces.hash).toBe(resultEchec.hash);
    expect(resultSucces.signature).toEqual(resultEchec.signature);
  });
});
