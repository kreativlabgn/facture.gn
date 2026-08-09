import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentsService } from "./payments.service";

// Mock à état mutable (pas juste des retours figés) : nécessaire pour prouver que
// l'incrément/décrément est bien relatif (Prisma { increment }/{ decrement }) et non
// une valeur absolue recalculée — deux appels séquentiels sur la même facture doivent
// cumuler correctement, ce qu'un mock à retour fixe ne peut pas vérifier.
function createFakePrisma(invoiceOverrides: Record<string, unknown> = {}, sameAmountRecentCount = 0) {
  let invoiceState: any = {
    id: "inv-1",
    status: "issued",
    amountPaid: 0n,
    amountDue: 1_500_000n,
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
        }
        if (data.status !== undefined) {
          next.status = data.status;
        }
        invoiceState = next;
        return Promise.resolve(invoiceState);
      }),
    },
    invoiceEvent: {
      create: vi.fn(({ data }: any) => Promise.resolve({ id: "event-1", ...data })),
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
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-1");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.amountPaid).toBe(1_500_000n);
    expect(invoice.status).toBe("paid");
  });

  it("fait passer la facture à partially_paid quand le montant réglé est inférieur au solde dû", async () => {
    const prisma = createFakePrisma({ amountDue: 2_000_000n, amountPaid: 500_000n });
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-2");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(500_000n);
    expect(invoice.amountPaid).toBe(2_000_000n);
    expect(invoice.status).toBe("partially_paid");
  });

  it("cumule correctement deux paiements successifs sur la même facture (pas d'écrasement par valeur absolue)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", { amount: 700_000n, method: "cash" as const }, "idem-key-a");
    await service.recordCashPayment("inv-1", { amount: 300_000n, method: "cash" as const }, "idem-key-b");

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(1_000_000n);
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.status).toBe("paid");
  });

  it("refuse un montant supérieur au solde dû restant (pas de sur-paiement silencieux)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_000_000n });
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-3")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture draft", async () => {
    const prisma = createFakePrisma({ status: "draft" });
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-4")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture voided", async () => {
    const prisma = createFakePrisma({ status: "voided" });
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-5")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture introuvable", async () => {
    const prisma = createFakePrisma();
    prisma.invoice.findUnique = vi.fn().mockResolvedValue(null);
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-6")).rejects.toThrow(NotFoundException);
  });

  it("un replay avec le même idempotencyKey renvoie le paiement déjà créé, ne recrée rien", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any);

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
    const service = new PaymentsService(prisma as any);

    const result = await service.recordCashPayment("inv-1", cashDto, "idem-key-race");

    expect(result).toBe(existingPayment);
  });

  it("commission toujours nulle pour un encaissement cash (0%, C1)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-7");

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platformFeeAmount: 0n, gatewayFeeAmount: 0n }),
      }),
    );
  });
});

describe("PaymentsService — détection de patterns d'anomalie cash (G1, ADR-032)", () => {
  it("écrit un InvoiceEvent suspicious_cash_pattern_detected pour un montant rond ≥ 1M GNF", async () => {
    const prisma = createFakePrisma({ amountDue: 150_000_000n });
    const service = new PaymentsService(prisma as any);

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
    const prisma = createFakePrisma({ amountDue: 5_000_000n, customerId: "client-1" }, 2);
    const service = new PaymentsService(prisma as any);

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
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", { amount: 123_456n, method: "cash" as const }, "idem-key-no-client");

    expect(prisma.payment.count).not.toHaveBeenCalled();
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });

  it("n'écrit aucun InvoiceEvent pour un paiement cash normal — le paiement réussit toujours (non-régression)", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any);

    const result = await service.recordCashPayment("inv-1", cashDto, "idem-key-normal");

    expect(result).toBeDefined();
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
    const service = new PaymentsService(prisma as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse un dépôt sur un proforma qui n'est plus draft", async () => {
    const prisma = createFakePrismaForDeposit({ status: "converted" });
    const service = new PaymentsService(prisma as any);

    await expect(
      service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-2"),
    ).rejects.toThrow(ConflictException);
  });

  it("enregistre l'arrhes sans jamais toucher amountPaid/amountDue de la facture", async () => {
    const prisma = createFakePrismaForDeposit();
    const service = new PaymentsService(prisma as any);

    const payment = await service.recordDepositPayment("proforma-1", depositDto, "idem-deposit-3");

    expect(payment.depositType).toBe("arrhes");
    expect(payment.method).toBe("cash");
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("refuse un second dépôt sur un proforma qui en a déjà un", async () => {
    const prisma = createFakePrismaForDeposit({}, { id: "payment-existing", depositType: "arrhes" });
    const service = new PaymentsService(prisma as any);

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
    const service = new PaymentsService(prisma as any);

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
    const service = new PaymentsService(prisma as any);

    await service.recordProviderPayment("inv-1", providerDto);

    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountDue).toBe(0n);
    expect(invoice.amountPaid).toBe(1_500_000n);
    expect(invoice.status).toBe("paid");
  });

  it("enregistre le paiement avec method payment_link, providerRef et la commission gateway réelle", async () => {
    const prisma = createFakePrisma({ amountDue: 1_500_000n });
    const service = new PaymentsService(prisma as any);

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
    const service = new PaymentsService(prisma as any);

    const first = await service.recordProviderPayment("inv-1", providerDto);
    const second = await service.recordProviderPayment("inv-1", providerDto);

    expect(second).toEqual(first);
    const invoice = await prisma.invoice.findUnique();
    expect(invoice.amountPaid).toBe(1_500_000n);
  });

  it("refuse un paiement sur une facture introuvable", async () => {
    const prisma = createFakePrisma();
    prisma.invoice.findUnique = vi.fn().mockResolvedValue(null);
    const service = new PaymentsService(prisma as any);

    await expect(service.recordProviderPayment("inv-1", providerDto)).rejects.toThrow(NotFoundException);
  });
});
