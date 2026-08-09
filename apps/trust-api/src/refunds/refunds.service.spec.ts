import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RefundsService } from "./refunds.service";

function createFakePrisma(creditNoteOverrides: Record<string, unknown> = {}, initialRefundedSum: bigint = 0n) {
  const creditNote = {
    id: "cn-1",
    invoiceId: "inv-1",
    amount: 300_000n,
    ...creditNoteOverrides,
  };

  // Somme mutable des remboursements non-"failed" déjà "créés" — nécessaire pour
  // prouver que la garde anti-sur-remboursement voit bien l'effet cumulatif de
  // remboursements partiels successifs, ce qu'un mock à retour figé ne peut pas
  // vérifier (même principe que le mock stateful de payments.service.spec.ts).
  let refundedSum = initialRefundedSum;
  let nextRefundId = 1;

  const prisma: any = {
    creditNote: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(creditNote),
    },
    refund: {
      aggregate: vi.fn().mockImplementation(() => Promise.resolve({ _sum: { amount: refundedSum } })),
      create: vi.fn().mockImplementation(({ data }: any) => {
        if (data.status !== "failed") {
          refundedSum += data.amount;
        }
        return Promise.resolve({ id: `refund-${nextRefundId++}`, ...data });
      }),
    },
    invoiceEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "event-1", ...data })),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

describe("RefundsService.create (C13, ADR-063)", () => {
  it("crée un remboursement cash immédiatement completed", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    const result = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou");

    expect(result.status).toBe("completed");
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(prisma.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ creditNoteId: "cn-1", invoiceId: "inv-1", amount: 100_000n, method: "cash" }),
      }),
    );
  });

  it("crée un remboursement payment_link_payout en pending — aucune exécution automatique (Djomy Payout, V2)", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    const result = await service.create("cn-1", { amount: 100_000n, method: "payment_link_payout" }, "user-djenabou");

    expect(result.status).toBe("pending");
    expect(result.completedAt).toBeNull();
  });

  it("refuse un remboursement dont le montant dépasse le solde encore remboursable de l'avoir", async () => {
    const prisma = createFakePrisma({ amount: 100_000n });
    const service = new RefundsService(prisma as any);

    await expect(
      service.create("cn-1", { amount: 150_000n, method: "cash" }, "user-djenabou"),
    ).rejects.toThrow(ConflictException);
  });

  it("accepte des remboursements partiels cumulés jusqu'au montant total, refuse le dépassement", async () => {
    // 300 000 au total, 250 000 déjà remboursés — il ne reste que 50 000.
    const prisma = createFakePrisma({}, 250_000n);
    const service = new RefundsService(prisma as any);

    const ok = await service.create("cn-1", { amount: 50_000n, method: "cash" }, "user-djenabou");
    expect(ok.status).toBe("completed");

    await expect(
      service.create("cn-1", { amount: 1n, method: "cash" }, "user-djenabou"),
    ).rejects.toThrow(ConflictException);
  });

  it("un remboursement failed n'est pas compté dans le solde déjà remboursé", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 300_000n, method: "cash" }, "user-djenabou");

    expect(prisma.refund.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "failed" } }) }),
    );
  });

  it("écrit un InvoiceEvent refund_issued avec actorId dans la même transaction", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: { invoiceId: "inv-1", type: "refund_issued", amount: 100_000n, actorId: "user-djenabou" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
