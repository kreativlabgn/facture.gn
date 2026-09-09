import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentLinksService } from "./payment-links.service";

const INVOICE_ID = "3b3963da-d099-43ea-996b-80000060b28a";
const MSISDN = "+224622000000";

// Une facture émise et non contestée : l'état par défaut de tout ce qui suit,
// pour que chaque test ne déclare que ce qu'il fait varier.
const FACTURE_PAYABLE = { status: "issued", disputeStatus: "none" };

const ATTEMPT_DJOMY = {
  provider: "djomy",
  paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
  amountGnf: 102_100_000n,
  feeGateway: 1_429_400n,
  feePlatform: 2_100_000n,
  expiresAt: null,
};

function createFakePrisma(attempt: any = null, invoice: any = FACTURE_PAYABLE) {
  return {
    paymentProviderAttempt: {
      // Le service interroge deux fois cette table : la tentative "success" qui
      // porte les montants, puis les "pending" pour la garde de double-débit.
      // Le faux distingue les deux sur le `status` demandé.
      findFirst: vi
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(where.status === "success" ? attempt : null),
        ),
      create: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
    },
  };
}

// `charge` non fourni : provider résolu SANS chargeMobileMoney — le cas Moneroo,
// où la capacité est absente et non en panne.
function createFakeProviders(charge?: any) {
  return {
    resolve: vi.fn().mockReturnValue(charge === undefined ? {} : { chargeMobileMoney: charge }),
  };
}

describe("PaymentLinksService", () => {
  it("délègue au registry et renvoie le lien résolu (Djomy ou Moneroo, transparent à l'appelant)", async () => {
    const registry = {
      resolve: vi.fn().mockResolvedValue({
        provider: "djomy",
        providerRef: "djomy-ref",
        paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
        feeGatewayGnf: 1_000_000n,
        expiresAt: new Date("2026-09-07T00:00:00.000Z"),
      }),
    };
    const service = new PaymentLinksService(
      registry as any,
      createFakeProviders() as any,
      createFakePrisma() as any,
    );

    const result = await service.createPaymentLink(
      INVOICE_ID,
      "92b6a988-f570-4b4f-94bc-3acfd2a98758",
      100_000_000n,
    );

    expect(registry.resolve).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
      amountGnf: 100_000_000n,
    });
    expect(result.provider).toBe("djomy");
    expect(result.paymentLinkUrl).toBe("https://stub.djomy.africa/pay/djomy-ref");
  });
});

describe("PaymentLinksService — checkout public (C19)", () => {
  it("retourne la dernière tentative réussie, uniquement les champs destinés au payeur", async () => {
    const prisma = createFakePrisma({
      provider: "djomy",
      paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
      amountGnf: 100_000_000n,
      feeGateway: 1_000_000n,
      feePlatform: 2_100_000n,
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
    });
    const service = new PaymentLinksService({} as any, createFakeProviders() as any, prisma as any);

    const result = await service.getPublicCheckout(INVOICE_ID);

    expect(prisma.paymentProviderAttempt.findFirst).toHaveBeenCalledWith({
      where: { invoiceId: INVOICE_ID, status: "success" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual({
      provider: "djomy",
      paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
      amountGnf: 100_000_000n,
      feeGatewayGnf: 1_000_000n,
      feePlatformGnf: 2_100_000n,
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
      payable: true,
      motifRefus: null,
      messageRefus: null,
    });
  });

  // `amountGnf` n'est PAS le prix de la marchandise : InvoicesService.issue()
  // transmet `totalTtc + platformFee`. Sans `feePlatformGnf`, le payeur ne peut
  // pas distinguer ce qui va au commerçant de ce qui va à facture.gn — et
  // l'écran de checkout affichait cette somme sous le libellé « Montant de la
  // facture », ce qui était faux.
  it("expose la commission plateforme persistée, pour que le payeur puisse la distinguer de la marchandise", async () => {
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders() as any,
      createFakePrisma(ATTEMPT_DJOMY) as any,
    );

    const result = await service.getPublicCheckout(INVOICE_ID);

    expect(result.feePlatformGnf).toBe(2_100_000n);
    // La marchandise se retrouve par soustraction, et elle doit tomber juste.
    expect(result.amountGnf - result.feePlatformGnf).toBe(100_000_000n);
  });

  it("lève NotFoundException si aucune tentative réussie n'existe pour cette facture", async () => {
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders() as any,
      createFakePrisma(null) as any,
    );

    await expect(service.getPublicCheckout(INVOICE_ID)).rejects.toThrow(NotFoundException);
  });

  // Le checkout ne lisait QUE payment_provider_attempt : il ignorait tout de la
  // facture, et proposait donc de régler une facture déjà soldée, annulée ou
  // contestée avec le même bouton actif.
  it.each([
    ["paid", "none", "deja_reglee"],
    ["voided", "none", "annulee"],
    ["issued", "disputed", "en_litige"],
    ["draft", "none", "non_encaissable"],
  ])("marque non payable une facture %s / litige %s", async (status, disputeStatus, motif) => {
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders() as any,
      createFakePrisma(ATTEMPT_DJOMY, { status, disputeStatus }) as any,
    );

    const result = await service.getPublicCheckout(INVOICE_ID);

    expect(result.payable).toBe(false);
    expect(result.motifRefus).toBe(motif);
    expect(result.messageRefus).toBeTruthy();
  });

  // Les montants restent affichés même quand le paiement est fermé : le payeur a
  // le droit de savoir ce qu'on lui réclamait, y compris sur une facture
  // annulée. Seul le bouton disparaît.
  it("continue d'exposer les montants d'une facture non payable", async () => {
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders() as any,
      createFakePrisma(ATTEMPT_DJOMY, { status: "paid", disputeStatus: "none" }) as any,
    );

    const result = await service.getPublicCheckout(INVOICE_ID);

    expect(result.payable).toBe(false);
    expect(result.amountGnf).toBe(102_100_000n);
    expect(result.feeGatewayGnf).toBe(1_429_400n);
  });
});

describe("PaymentLinksService — débit Mobile Money (Chantier 3)", () => {
  function chargeReussie() {
    return vi.fn().mockResolvedValue({
      providerRef: "djomy-stub-charge-ref",
      status: "pending",
      feeGatewayGnf: 1_429_400n,
      instruction: "Composez #144#",
    });
  }

  it("pousse le débit et retourne le total réellement débité, frais gateway compris", async () => {
    const charge = chargeReussie();
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders(charge) as any,
      createFakePrisma(ATTEMPT_DJOMY) as any,
    );

    const result = await service.chargeMobileMoney(INVOICE_ID, MSISDN, "orange_money");

    expect(charge).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      msisdn: MSISDN,
      operator: "orange_money",
      // Le gateway calcule ses frais sur marchandise + commission, jamais sur le
      // total : lui transmettre le total ferait des frais sur les frais.
      amountGnf: 102_100_000n,
      idempotencyKey: `${INVOICE_ID}:charge:${MSISDN}`,
    });
    expect(result.status).toBe("pending");
    expect(result.totalDebiteGnf).toBe(102_100_000n + 1_429_400n);
  });

  // Le cœur de la garde : l'écran a déjà désactivé le bouton, mais un bouton
  // désactivé se réactive depuis la console du navigateur. C'est ce refus-ci qui
  // protège réellement le payeur.
  it.each([
    ["paid", "none"],
    ["voided", "none"],
    ["issued", "disputed"],
  ])(
    "refuse le débit sur une facture %s / litige %s, sans jamais appeler le gateway",
    async (status, disputeStatus) => {
      const charge = chargeReussie();
      const service = new PaymentLinksService(
        {} as any,
        createFakeProviders(charge) as any,
        createFakePrisma(ATTEMPT_DJOMY, { status, disputeStatus }) as any,
      );

      await expect(service.chargeMobileMoney(INVOICE_ID, MSISDN, "orange_money")).rejects.toThrow(
        ConflictException,
      );
      expect(charge).not.toHaveBeenCalled();
    },
  );

  it("refuse un second débit tant qu'un premier est en attente de validation", async () => {
    const charge = chargeReussie();
    const prisma = createFakePrisma(ATTEMPT_DJOMY);
    // Cette fois, une tentative "pending" existe déjà en base.
    prisma.paymentProviderAttempt.findFirst = vi
      .fn()
      .mockImplementation(({ where }: any) =>
        Promise.resolve(where.status === "success" ? ATTEMPT_DJOMY : { id: "en-vol" }),
      );
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders(charge) as any,
      prisma as any,
    );

    await expect(service.chargeMobileMoney(INVOICE_ID, MSISDN, "orange_money")).rejects.toThrow(
      ConflictException,
    );
    expect(charge).not.toHaveBeenCalled();
  });

  // ADR-106 — le payeur a consenti à un total affiché. Si le gateway facture
  // autre chose, on n'encaisse pas : un débit supérieur au consentement donné ne
  // se rattrape pas après coup.
  it("annule le débit si le gateway facture d'autres frais que ceux annoncés", async () => {
    const charge = vi.fn().mockResolvedValue({
      providerRef: "djomy-stub-charge-ref",
      status: "pending",
      feeGatewayGnf: 9_999_999n, // ≠ attempt.feeGateway
      instruction: "Composez #144#",
    });
    const prisma = createFakePrisma(ATTEMPT_DJOMY);
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders(charge) as any,
      prisma as any,
    );

    await expect(service.chargeMobileMoney(INVOICE_ID, MSISDN, "orange_money")).rejects.toThrow(
      ConflictException,
    );
    // Rien n'est persisté : la tentative divergente ne laisse pas de trace
    // "pending" qui bloquerait ensuite tout nouvel essai légitime.
    expect(prisma.paymentProviderAttempt.create).not.toHaveBeenCalled();
  });

  it("refuse proprement quand le provider ne sait pas pousser de débit (Moneroo)", async () => {
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders() as any,
      createFakePrisma(ATTEMPT_DJOMY) as any,
    );

    await expect(service.chargeMobileMoney(INVOICE_ID, MSISDN, "orange_money")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("enregistre la tentative en 'pending' et jamais en 'success' — le webhook seul encaisse", async () => {
    const prisma = createFakePrisma(ATTEMPT_DJOMY);
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders(chargeReussie()) as any,
      prisma as any,
    );

    await service.chargeMobileMoney(INVOICE_ID, MSISDN, "mtn_momo");

    expect(prisma.paymentProviderAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoiceId: INVOICE_ID, status: "pending" }),
    });
  });

  it("traite une facture introuvable comme non encaissable, jamais comme payable par défaut", async () => {
    const charge = chargeReussie();
    const service = new PaymentLinksService(
      {} as any,
      createFakeProviders(charge) as any,
      createFakePrisma(ATTEMPT_DJOMY, null) as any,
    );

    await expect(service.chargeMobileMoney(INVOICE_ID, MSISDN, "orange_money")).rejects.toThrow(
      ConflictException,
    );
    expect(charge).not.toHaveBeenCalled();
  });
});
