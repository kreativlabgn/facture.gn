import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentsService } from "./payments.service";

function createFakePrisma(overrides: { invoice?: any; payment?: any } = {}) {
  const prisma: any = {
    payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "payment-1", ...data })),
      ...overrides.payment,
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue({
        id: "inv-1",
        status: "issued",
        amountPaid: 0n,
        amountDue: 1_500_000n,
        ...overrides.invoice,
      }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
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
    const prisma = createFakePrisma({ invoice: { amountDue: 1_500_000n } });
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-1");

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { amountPaid: 1_500_000n, amountDue: 0n, status: "paid" },
    });
  });

  it("fait passer la facture à partially_paid quand le montant réglé est inférieur au solde dû", async () => {
    const prisma = createFakePrisma({ invoice: { amountDue: 2_000_000n, amountPaid: 500_000n } });
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-2");

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { amountPaid: 2_000_000n, amountDue: 500_000n, status: "partially_paid" },
    });
  });

  it("refuse un montant supérieur au solde dû restant (pas de sur-paiement silencieux)", async () => {
    const prisma = createFakePrisma({ invoice: { amountDue: 1_000_000n } });
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-3")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture draft", async () => {
    const prisma = createFakePrisma({ invoice: { status: "draft" } });
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-4")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture voided", async () => {
    const prisma = createFakePrisma({ invoice: { status: "voided" } });
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-5")).rejects.toThrow(ConflictException);
  });

  it("refuse un paiement sur une facture introuvable", async () => {
    const prisma = createFakePrisma({ invoice: null as any });
    prisma.invoice.findUnique = vi.fn().mockResolvedValue(null);
    const service = new PaymentsService(prisma as any);

    await expect(service.recordCashPayment("inv-1", cashDto, "idem-key-6")).rejects.toThrow(NotFoundException);
  });

  it("un replay avec le même idempotencyKey renvoie le paiement déjà créé, ne recrée rien", async () => {
    const existingPayment = { id: "payment-existing", invoiceId: "inv-1", amount: 1_500_000n };
    const prisma = createFakePrisma({ payment: { findUnique: vi.fn().mockResolvedValue(existingPayment) } });
    const service = new PaymentsService(prisma as any);

    const result = await service.recordCashPayment("inv-1", cashDto, "idem-key-replay");

    expect(result).toBe(existingPayment);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("un conflit d'idempotence détecté au niveau DB (course concurrente) renvoie le paiement existant plutôt qu'un 500 brut", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["idempotency_key"] },
    });
    const existingPayment = { id: "payment-existing", invoiceId: "inv-1", amount: 1_500_000n };
    const prisma = createFakePrisma({
      payment: {
        create: vi.fn().mockRejectedValue(uniqueViolation),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null) // premier lookup : rien trouvé, on tente de créer
          .mockResolvedValueOnce(existingPayment), // second lookup après l'échec de création : la course concurrente l'a créé entre-temps
      },
    });
    const service = new PaymentsService(prisma as any);

    const result = await service.recordCashPayment("inv-1", cashDto, "idem-key-race");

    expect(result).toBe(existingPayment);
  });

  it("commission toujours nulle pour un encaissement cash (0%, C1)", async () => {
    const prisma = createFakePrisma({ invoice: { amountDue: 1_500_000n } });
    const service = new PaymentsService(prisma as any);

    await service.recordCashPayment("inv-1", cashDto, "idem-key-7");

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platformFeeAmount: 0n, gatewayFeeAmount: 0n }),
      }),
    );
  });
});
