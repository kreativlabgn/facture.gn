import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentsService } from "./payments.service";

// Mock à état mutable (pas juste des retours figés) : nécessaire pour prouver que
// l'incrément/décrément est bien relatif (Prisma { increment }/{ decrement }) et non
// une valeur absolue recalculée — deux appels séquentiels sur la même facture doivent
// cumuler correctement, ce qu'un mock à retour fixe ne peut pas vérifier.
function createFakePrisma(invoiceOverrides: Record<string, unknown> = {}) {
  let invoiceState: any = {
    id: "inv-1",
    status: "issued",
    amountPaid: 0n,
    amountDue: 1_500_000n,
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
