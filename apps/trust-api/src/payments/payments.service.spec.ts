import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentsService } from "./payments.service";

// null par défaut = aucun lien de paiement généré (cas le plus courant en test
// unitaire, même convention que invoices.service.spec.ts).
function createFakePaymentLinkClient(result: any = null) {
  return { tryGenerate: vi.fn().mockResolvedValue(result) };
}

// Mock à état mutable (pas juste des retours figés) : nécessaire pour prouver que
// l'incrément/décrément est bien relatif (Prisma { increment }/{ decrement }) et non
// une valeur absolue recalculée — deux appels séquentiels sur la même facture doivent
// cumuler correctement, ce qu'un mock à retour fixe ne peut pas vérifier.
function createFakePrisma(
  invoiceOverrides: Record<string, unknown> = {},
  sameAmountRecentCount = 0,
  organizationOverrides: Record<string, unknown> = {},
) {
  let invoiceState: any = {
    id: "inv-1",
    status: "issued",
    amountPaid: 0n,
    amountDue: 1_500_000n,
    // 0n par défaut (C14), cohérent avec Invoice.overpaymentAmount @default(0) —
    // n'affecte aucun test préexistant qui ne le surcharge pas.
    overpaymentAmount: 0n,
    organizationId: "org-1",
    // null par défaut (G1) : la vérification de boucle client/montant ne s'applique
    // qu'aux factures avec un client identifié — n'affecte aucun test préexistant.
    customerId: null,
    ...invoiceOverrides,
  };
  const paymentsByIdempotencyKey = new Map<string, any>();
  let nextPaymentId = 1;

  const prisma: any = {
    payment: {
      findUnique: vi.fn(({ where }: any) =>
        Promise.resolve(paymentsByIdempotencyKey.get(where.idempotencyKey) ?? null),
      ),
      create: vi.fn(({ data }: any) => {
        const payment = { id: `payment-${nextPaymentId++}`, ...data };
        paymentsByIdempotencyKey.set(data.idempotencyKey, payment);
        return Promise.resolve(payment);
      }),
      // Nombre de paiements cash identiques déjà vus pour le même client (G1) —
      // 0 par défaut, n'affecte aucun test préexistant qui ne le surcharge pas.
      count: vi.fn(() => Promise.resolve(sameAmountRecentCount)),
    },
    invoice: {
      findUnique: vi.fn(() => Promise.resolve(invoiceState)),
      update: vi.fn(({ data }: any) => {
        const next = { ...invoiceState };
        if (data.amountPaid && typeof data.amountPaid === "object" && "increment" in data.amountPaid) {
          next.amountPaid = invoiceState.amountPaid + data.amountPaid.increment;
        }
        if (data.amountDue && typeof data.amountDue === "object" && "decrement" in data.amountDue) {
          next.amountDue = invoiceState.amountDue - data.amountDue.decrement;
        } else if (typeof data.amountDue === "bigint") {
          // Valeur directe (C14) : correction du trop-perçu, jamais utilisée pour
          // un incrément/décrément normal — voir applyPaymentToInvoice().
          next.amountDue = data.amountDue;
        }
        if (data.overpaymentAmount && typeof data.overpaymentAmount === "object" && "increment" in data.overpaymentAmount) {
          next.overpaymentAmount = invoiceState.overpaymentAmount + data.overpaymentAmount.increment;
        }
        if (data.status !== undefined) {
          next.status = data.status;
        }
        invoiceState = next;
        return Promise.resolve(invoiceState);
      }),
      // Réclame atomiquement sur le statut au moment de l'écriture (même précédent
      // que convertToInvoice()/forfeitDeposit()) : count: 0 si l'état a changé
      // depuis la lecture initiale (course concurrente) — voir C11, régénération
      // de lien après paiement partiel.
      updateMany: vi.fn(({ where, data }: any) => {
        if (where.status !== undefined && invoiceState.status !== where.status) {
          return Promise.resolve({ count: 0 });
        }
        invoiceState = { ...invoiceState, ...data };
        return Promise.resolve({ count: 1 });
      }),
    },
    invoiceEvent: {
      create: vi.fn(({ data }: any) => Promise.resolve({ id: "event-1", ...data })),
    },
    // commercialTier: freemium par défaut (grille commission, ADR-074) — utilisé
    // uniquement par recordProviderPayment()/regenerateLinkForRemainingBalance().
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "freemium", ...organizationOverrides }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

const cashDto = {
  amount: 1_500_000n,
  method: "cash" as const,
};

describe("PaymentsService — encaissement cash", () => {
  it("fait passer la facture à paid quand le montant réglé couvre exactement le solde dû", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-1");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.amountPaid).toBe(1_500_000n);
    expect(invoice.status).toBe("paid");
  });

  it("fait passer la facture à partially_paid quand le montant réglé est inférieur au solde dû", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-2");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(500_000n);
    expect(invoice.amountPaid).toBe(2_000_000n);
    expect(invoice.status).toBe("partially_paid");
  });

  it("cumule correctement deux paiements successifs sur la même facture (pas d'écrasement par valeur absolue)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 700_000n, method: "cash" as const }, "idem-key-a");
    await service.recordCashPayment("inv-1", { amount: 300_000n, method: "cash" as const }, "idem-key-b");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(1_000_000n);
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.status).toBe("paid");
  });

  // Avant C14 : tout montant cash > solde dû était rejeté ("trop-perçu non géré").
  // Depuis C14, le cash absorbe l'excédent dans Invoice.overpaymentAmount plutôt que
  // de bloquer l'encaissement — voir describe("PaymentsService — trop-perçu cash").

  it("refuse un paiement sur une facture draft", async () => {
    const prisma = createFakePrisma({ status: "draft" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-4")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture voided", async () => {
    const prisma = createFakePrisma({ status: "voided" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-5")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture introuvable", async () => {
    const prisma = createFakePrisma();
    prisma.invoice.findUnique = vi.fn().mockResolvedValue(null);
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-6")).rejects.toThrow(NotFoundException);
  });

  it("un replay avec le même idempotencyKey renvoie le paiement déjà créé, ne recrée rien", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const first = await service.recordCashPayment("inv-1", cashDto, "idem-key-replay");
    const second = await service.recordCashPayment("inv-1", cashDto, "idem-key-replay");

    expect(second).toEqual(first);
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(1_500_000n); // pas doublé par le replay
  });

  it("un conflit d'idempotence détecté au niveau DB (course concurrente) renvoie le paiement existant plutôt qu'un 500 brut", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["idempotency_key"] },
    });
    const existingPayment = { id: "payment-existing", invoiceId: "inv-1", amount: 1_500_000n };
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    prisma.payment.create = vi.fn().mockRejectedValue(uniqueViolation);
    prisma.payment.findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // premier lookup : rien trouvé, on tente de créer
      .mockResolvedValueOnce(existingPayment); // second lookup après l'échec : la course concurrente l'a créé entre-temps
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const result = await service.recordCashPayment("inv-1", cashDto, "idem-key-race");

    expect(result).toBe(existingPayment);
  });

  it("commission toujours nulle pour un encaissement cash (0%, C1)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-7");

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platformFeeAmount: 0n, gatewayFeeAmount: 0n }),
      }),
    );
  });
});

describe("PaymentsService — trop-perçu cash (C14)", () => {
  it("accepte un paiement cash supérieur au solde dû et trace l'excédent dans overpaymentAmount", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 1_300_000n, method: "cash" as const }, "idem-key-overpaid");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.amountPaid).toBe(1_300_000n);
    expect(invoice.overpaymentAmount).toBe(300_000n);
    expect(invoice.status).toBe("paid");
  });

  it("montant cash exactement égal au solde dû — overpaymentAmount reste 0 (non-régression)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 1_000_000n, method: "cash" as const }, "idem-key-exact");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.overpaymentAmount).toBe(0n);
    expect(invoice.status).toBe("paid");
  });

  it("montant cash inférieur au solde dû — overpaymentAmount reste 0 (non-régression)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 400_000n, method: "cash" as const }, "idem-key-partiel");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(600_000n);
    expect(invoice.overpaymentAmount).toBe(0n);
    expect(invoice.status).toBe("partially_paid");
  });

  // Repurposé (ADR-074, grille commission) : dto.amountGnf dépasse désormais
  // TOUJOURS invoice.amountDue légitimement (majoration commission déjà incluse
  // dans le lien généré, voir invoices.service.ts:issue()) — l'ancien garde-fou
  // "rejette si amountGnf > amountDue" rejetterait donc tout paiement provider
  // légitime. Ce test vérifie désormais que l'invariant qu'il protégeait
  // ORIGINELLEMENT reste vrai autrement : le montant appliqué à l'invoice est
  // TOUJOURS invoice.amountDue exact, jamais dto.amountGnf — donc jamais de faux
  // trop-perçu (overpaymentAmount) même quand dto.amountGnf dépasse largement
  // amountDue.
  it("accepte un dto.amountGnf largement supérieur à amountDue (commission incluse) sans jamais déclencher le trop-perçu C14", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const payment = await service.recordProviderPayment("inv-1", {
      amountGnf: 1_300_000n,
      provider: "djomy" as const,
      providerRef: "djomy-stub-overpaid",
      feeGatewayGnf: 13_000n,
    });

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.status).toBe("paid");
    expect(invoice.overpaymentAmount).toBe(0n); // jamais une fausse détection de trop-perçu
    expect(payment.amount).toBe(1_000_000n); // appliqué : amountDue exact, jamais dto.amountGnf
    expect(payment.amountCollected).toBe(1_300_000n); // rapporté tel quel (money-api)
    expect(payment.platformFeeAmount).toBe(21_000n); // 2,1% freemium de 1 000 000 (corrigé)
  });
});

describe("PaymentsService — détection de patterns d'anomalie cash (G1, ADR-032)", () => {
  it("écrit un InvoiceEvent suspicious_cash_pattern_detected pour un montant rond ≥ 1M GNF", async () => {
    const prisma = createFakePrisma({ amountDue: 150_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 150_000_000n, method: "cash" as const }, "idem-key-round");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: {
        invoiceId: "inv-1",
        type: "suspicious_cash_pattern_detected",
        actorId: null,
        amount: 150_000_000n,
        metadata: { patterns: ["round_amount"] },
      },
    });
  });

  it("écrit un InvoiceEvent client_amount_loop au 3e paiement identique pour le même client", async () => {
    const prisma = createFakePrisma({ amountDue: 5_000_000n, customerId: "client-1" }, 3);
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 123_456n, method: "cash" as const }, "idem-key-loop");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: {
        invoiceId: "inv-1",
        type: "suspicious_cash_pattern_detected",
        actorId: null,
        amount: 123_456n,
        metadata: { patterns: ["client_amount_loop"] },
      },
    });
  });

  it("ignore la vérification de boucle quand customerId est absent, même si le montant se répète", async () => {
    const prisma = createFakePrisma({ amountDue: 5_000_000n, customerId: null }, 5);
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordCashPayment("inv-1", { amount: 123_456n, method: "cash" as const }, "idem-key-no-client");

    expect(prisma.payment.count).not.toHaveBeenCalled();
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });

  it("n'écrit aucun InvoiceEvent pour un paiement cash normal — le paiement réussit toujours (non-régression)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const result = await service.recordCashPayment("inv-1", cashDto, "idem-key-normal");

    expect(result).toBeDefined();
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });

  it("un paiement cash légitime réussit même si la détection d'anomalie échoue — meilleur effort, jamais couplé (revue sécurité)", async () => {
    const prisma = createFakePrisma({ amountDue: 5_000_000n, customerId: "client-1" });
    prisma.payment.count = vi.fn().mockRejectedValue(new Error("panne DB inattendue sur la détection"));
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const result = await service.recordCashPayment(
      "inv-1",
      { amount: 123_456n, method: "cash" as const },
      "idem-key-detection-failure",
    );

    expect(result).toBeDefined();
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(123_456n);
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });
});

function createFakePrismaForDeposit(invoiceOverrides: Record<string, unknown> = {}, existingDeposit: any = null) {
  const invoiceState: any = {
    id: "proforma-1",
    documentType: "proforma",
    status: "draft",
    ...invoiceOverrides,
  };
  let nextPaymentId = 1;

  const prisma: any = {
    payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(existingDeposit),
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `payment-${nextPaymentId++}`, ...data }),
      ),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoiceState),
      update: vi.fn(),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

const depositDto = { amount: 300_000n };

describe("PaymentsService — arrhes sur proforma (C5, ADR-034)", () => {
  it("refuse un dépôt sur un document qui n'est pas un proforma", async () => {
    const prisma = createFakePrismaForDeposit({ documentType: "invoice" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse un dépôt sur un devis — C16 élargit convertToInvoice() aux devis, jamais recordDepositPayment() (non-régression)", async () => {
    const prisma = createFakePrismaForDeposit({ documentType: "quote" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-quote"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse un dépôt sur un proforma qui n'est plus draft", async () => {
    const prisma = createFakePrismaForDeposit({ status: "converted" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-2"),
    ).rejects.toThrow(ConflictException);
  });

  it("enregistre l'arrhes sans jamais toucher amountPaid/amountDue de la facture", async () => {
    const prisma = createFakePrismaForDeposit();
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const payment = await service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-3");

    expect(payment.depositType).toBe("arrhes");
    expect(payment.method).toBe("cash");
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("refuse un second dépôt sur un proforma qui en a déjà un", async () => {
    const prisma = createFakePrismaForDeposit({}, { id: "payment-existing", depositType: "arrhes" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-4"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse proprement (jamais un 500 brut) une course concurrente détectée par l'index unique payment_one_arrhes_per_invoice, pas seulement par le lookup idempotency_key", async () => {
    // Reproduction exacte de la violation P2002 réelle observée contre Postgres :
    // deux requêtes avec des Idempotency-Key DIFFÉRENTES passent toutes deux le
    // lookup idempotency_key et le findFirst applicatif avant que l'une des deux ne
    // committe — seul l'index unique partiel (invoice_id WHERE deposit_type='arrhes')
    // tranche, avec meta.target=["invoice_id"], jamais "idempotency_key".
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["invoice_id"] },
    });
    const prisma = createFakePrismaForDeposit();
    prisma.payment.create = vi.fn().mockRejectedValue(uniqueViolation);
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-race"),
    ).rejects.toThrow(ConflictException);
  });
});

describe("PaymentsService — confirmation de paiement provider (C2 Phase 2b, appelé par money-api)", () => {
  const providerDto = {
    amountGnf: 1_500_000n,
    provider: "djomy" as const,
    providerRef: "djomy-stub-inv-1",
    feeGatewayGnf: 15_000n,
  };

  it("fait passer la facture à paid et réutilise le même incrément atomique que le cash (C1)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordProviderPayment("inv-1", providerDto);

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.amountPaid).toBe(1_500_000n);
    expect(invoice.status).toBe("paid");
  });

  it("enregistre le paiement avec method payment_link, providerRef et la commission gateway réelle", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordProviderPayment("inv-1", providerDto);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          method: "payment_link",
          providerRef: "djomy-stub-inv-1",
          gatewayFeeAmount: 15_000n,
          idempotencyKey: "djomy-stub-inv-1",
        }),
      }),
    );
  });

  it("est idempotent par providerRef — un replay renvoie le paiement déjà créé, ne double-crédite jamais", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const first = await service.recordProviderPayment("inv-1", providerDto);
    const second = await service.recordProviderPayment("inv-1", providerDto);

    expect(second).toEqual(first);
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(1_500_000n);
  });

  it("calcule platformFeeAmount selon le palier commercial de l'organisation (ADR-074) — pro 1,5%, pas freemium", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n }, 0, { commercialTier: "pro" });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordProviderPayment("inv-1", providerDto);

    // 1,5% de 1 500 000 = 22 500 (pro, pas 2,5% freemium = 37 500).
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ platformFeeAmount: 22_500n }) }),
    );
  });

  it("refuse un paiement sur une facture introuvable", async () => {
    const prisma = createFakePrisma();
    prisma.invoice.findUnique = vi.fn().mockResolvedValue(null);
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(service.recordProviderPayment("inv-1", providerDto)).rejects.toThrow(NotFoundException);
  });
});

describe("PaymentsService — encaissement par virement bancaire (C3, ADR-052)", () => {
  it("enregistre le virement avec method bank_transfer et une commission nulle", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordBankTransferPayment("inv-1", { amount: 1_500_000n }, "idem-bt-1");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.amountPaid).toBe(1_500_000n);
    expect(invoice.status).toBe("paid");
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ method: "bank_transfer", platformFeeAmount: 0n, gatewayFeeAmount: 0n }),
      }),
    );
  });

  it("refuse un virement dont le montant dépasse le solde dû — contrairement au cash (C14 non étendu ici)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await expect(
      service.recordBankTransferPayment("inv-1", { amount: 1_300_000n }, "idem-bt-2"),
    ).rejects.toThrow(ConflictException);
  });

  it("un replay avec le même idempotencyKey renvoie le paiement déjà créé, ne recrée rien", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    const first = await service.recordBankTransferPayment("inv-1", { amount: 1_500_000n }, "idem-bt-replay");
    const second = await service.recordBankTransferPayment("inv-1", { amount: 1_500_000n }, "idem-bt-replay");

    expect(second).toEqual(first);
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(1_500_000n);
  });

  it("n'écrit aucun InvoiceEvent de détection d'anomalie — G1 reste strictement cash-only", async () => {
    const prisma = createFakePrisma({ amountDue: 150_000_000n });
    const service = new PaymentsService(prisma as any, createFakePaymentLinkClient() as any);

    await service.recordBankTransferPayment("inv-1", { amount: 150_000_000n }, "idem-bt-3");

    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });
});

const relinkResult = {
  paymentLinkUrl: "https://pay.facture.gn/solde-restant",
  providerRef: "djomy-ref-solde",
  expiresAt: new Date("2026-09-08T00:00:00.000Z"),
};

describe("PaymentsService — nouveau lien pour le solde restant après paiement partiel (C11, ADR-062)", () => {
  it("régénère le lien de paiement pour amountDue (solde restant) après un paiement cash partiel", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const paymentLinkClient = createFakePaymentLinkClient(relinkResult);
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-relink-1");

    // 500 000 + commission freemium 2,1% (10 500) = 510 500 (ADR-074, corrigé).
    expect(paymentLinkClient.tryGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ amountGnf: 510_500n }),
    );
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1", status: "partially_paid" },
        data: expect.objectContaining({
          paymentLinkUrl: "https://pay.facture.gn/solde-restant",
          paymentLinkId: "djomy-ref-solde",
        }),
      }),
    );
  });

  it("écrit un InvoiceEvent payment_link_regenerated avec actorId null (régénération système, pas humaine)", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const paymentLinkClient = createFakePaymentLinkClient(relinkResult);
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-relink-2");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "payment_link_regenerated", actorId: null }),
      }),
    );
  });

  it("ne régénère AUCUN lien quand le paiement cash solde entièrement la facture (paid)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const paymentLinkClient = createFakePaymentLinkClient(relinkResult);
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-relink-3");

    expect(paymentLinkClient.tryGenerate).not.toHaveBeenCalled();
  });

  it("un échec de génération de lien (tryGenerate renvoie null) n'empêche jamais le paiement de réussir", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const paymentLinkClient = createFakePaymentLinkClient(null);
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    const payment = await service.recordCashPayment("inv-1", cashDto, "idem-relink-4");

    expect(payment).toBeDefined();
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.status).toBe("partially_paid");
  });

  it("même comportement pour un virement bancaire partiel (C3)", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const paymentLinkClient = createFakePaymentLinkClient(relinkResult);
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    await service.recordBankTransferPayment("inv-1", { amount: 1_500_000n }, "idem-relink-5");

    // 500 000 + commission freemium 2,1% (10 500) = 510 500 (ADR-074, corrigé).
    expect(paymentLinkClient.tryGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ amountGnf: 510_500n }),
    );
  });

  it("n'écrit jamais un lien devenu obsolète si la facture est passée à paid pendant l'appel money-api (course concurrente, revue résilience)", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    // Simule un 2e paiement concurrent qui solde la facture PENDANT l'appel HTTP
    // à money-api (tryGenerate) — la lecture initiale voyait encore "partially_paid".
    const paymentLinkClient = {
      tryGenerate: vi.fn().mockImplementation(async () => {
        await prisma.invoice.update({ where: { id: "inv-1" }, data: { status: "paid", amountDue: 0n } });
        return relinkResult;
      }),
    };
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-relink-race");

    // updateMany n'a rien appliqué (count: 0, le statut n'est plus partially_paid)
    // et l'InvoiceEvent n'a jamais été écrit — jamais une trace d'audit mensongère.
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.paymentLinkUrl).toBeUndefined();
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });

  it("ne régénère jamais après un paiement provider (C2 Phase 2b) — exclusion volontaire", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const paymentLinkClient = createFakePaymentLinkClient(relinkResult);
    const service = new PaymentsService(prisma as any, paymentLinkClient as any);

    await service.recordProviderPayment("inv-1", {
      amountGnf: 1_500_000n,
      provider: "djomy" as const,
      providerRef: "djomy-stub-relink",
      feeGatewayGnf: 15_000n,
    });

    expect(paymentLinkClient.tryGenerate).not.toHaveBeenCalled();
  });
});
