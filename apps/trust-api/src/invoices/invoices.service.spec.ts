import { describe, expect, it, vi } from "vitest";
import { InvoicesService } from "./invoices.service";

function createFakePrisma(overrides: { invoice?: any; organization?: any } = {}) {
  // update() cumulatif (comme le vrai Prisma, qui renvoie toujours la ligne complète,
  // pas seulement les champs patchés) — nécessaire car issue() peut faire deux
  // update() successifs (certification, puis lien de paiement en meilleur effort).
  // documentType: "invoice" par défaut (C15, ADR-064) — reflète @default(invoice) du
  // schema ; les tests qui exercent explicitement un proforma le surchargent.
  let invoiceState: any = { id: "inv-1", documentType: "invoice" };
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

function createFakePrismaForCreateDraft(regimeFiscal: string) {
  return {
    invoice: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal }),
    },
  };
}

describe("InvoicesService — régime fiscal appliqué automatiquement (C4, ADR-033)", () => {
  it("calcule totalHt/totalTva à 18% pour une organisation normal_tva, jamais un taux client", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
    } as any);

    expect(result.totalTtc).toBe(1_180_000n);
    expect(result.totalHt).toBe(1_000_000n);
    expect(result.totalTva).toBe(180_000n);
  });

  it("n'applique aucune TVA pour une organisation tpu — impôt forfaitaire séparé, pas une TVA sur facture", async () => {
    const prisma = createFakePrismaForCreateDraft("tpu");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 350_000n }],
    } as any);

    expect(result.totalTva).toBe(0n);
    expect(result.totalHt).toBe(result.totalTtc);
  });

  it("garantit totalHt + totalTva === totalTtc même sur un montant qui ne se divise pas exactement par 1,18 (arrondi bigint)", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_000_000n }],
    } as any);

    expect(result.totalHt + result.totalTva).toBe(result.totalTtc);
  });
});

function createFakePrismaForConvertToInvoice(
  proforma: any,
  regimeFiscal: string,
  updateManyCount = 1,
) {
  const proformaState = { ...proforma };
  const prisma: any = {
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(proformaState),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-2", ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...proformaState, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

describe("InvoicesService — proforma → facture (C15, ADR-064)", () => {
  it("refuse d'émettre un proforma directement — /issue réservé aux factures", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", documentType: "proforma" }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1")).rejects.toThrow(/proforma/);
  });

  it("refuse de convertir un document qui n'est pas un proforma", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      { id: "inv-1", documentType: "invoice", status: "draft", organizationId: "org-1", totalTtc: 350_000n, lines: [] },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.convertToInvoice("inv-1")).rejects.toThrow(/proforma/);
  });

  it("refuse de convertir un proforma déjà converti — empêche une double conversion", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "converted",
        organizationId: "org-1",
        totalTtc: 350_000n,
        lines: [],
      },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.convertToInvoice("inv-1")).rejects.toThrow(/statut/);
  });

  it("crée une nouvelle facture draft et marque le proforma converted avec convertedToInvoiceId", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 350_000n,
        lines: [{ description: "Nuitée hôtel", quantity: 1, unitPrice: 350_000n, taxRateBps: 0 }],
      },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    const newInvoice = await service.convertToInvoice("inv-1");

    expect(newInvoice.documentType).toBe("invoice");
    expect(newInvoice.status).toBe("draft");
    expect(newInvoice.totalTtc).toBe(350_000n);
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", status: "draft" },
      data: { status: "converted" },
    });
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { convertedToInvoiceId: "inv-2" },
    });
  });

  it("recalcule le régime fiscal depuis l'organisation ACTUELLE, jamais depuis les lignes déjà stockées sur le proforma", async () => {
    // Le proforma a été créé quand l'organisation était tpu (taxRateBps=0 sur ses
    // lignes) — au moment de la conversion, l'organisation est mockée normal_tva :
    // la nouvelle facture doit refléter 18%, pas le 0% figé sur le proforma.
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 1_180_000n,
        lines: [{ description: "Prestation conseil", quantity: 1, unitPrice: 1_180_000n, taxRateBps: 0 }],
      },
      "normal_tva",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    const newInvoice = await service.convertToInvoice("inv-1");

    expect(newInvoice.totalHt).toBe(1_000_000n);
    expect(newInvoice.totalTva).toBe(180_000n);
  });

  it("refuse une conversion concurrente — deux appels quasi simultanés ne peuvent pas produire deux factures pour un même proforma", async () => {
    // updateMany count=0 simule le cas où une autre transaction a déjà fait basculer
    // ce proforma hors de draft entre notre lecture initiale et notre écriture —
    // reproduction réaliste d'un retry réseau (PWA offline-first, réseau mobile
    // instable) qui renverrait deux POST /convert-to-invoice quasi simultanés.
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 350_000n,
        lines: [{ description: "Nuitée hôtel", quantity: 1, unitPrice: 350_000n, taxRateBps: 0 }],
      },
      "tpu",
      0,
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeCertification() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.convertToInvoice("inv-1")).rejects.toThrow(/conver/);
  });
});

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
          documentType: "invoice",
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
          documentType: "invoice",
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
          documentType: "invoice",
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

  it("traduit une violation de contrainte unique sur certification_id en erreur explicite, jamais un 500 brut (collision entre organisations sans NIF, B1/B4)", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["certification_id"] },
    });
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
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

    await expect(service.issue("inv-1")).rejects.toThrow(/certification/);
  });
});

describe("InvoicesService — lien de paiement à l'émission (C2 Phase 2a)", () => {
  const draftInvoice = {
    id: "inv-1",
    status: "draft",
    documentType: "invoice",
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
