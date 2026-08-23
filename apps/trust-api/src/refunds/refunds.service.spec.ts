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
  // Security Audit 2026-08-23, finding #2 — simule la contrainte unique
  // idempotency_key : findUnique() reflète l'état déjà "créé" par la même clé.
  const refundsByIdempotencyKey = new Map<string, any>();

  const prisma: any = {
    creditNote: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(creditNote),
    },
    refund: {
      findUnique: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(refundsByIdempotencyKey.get(where.idempotencyKey) ?? null),
      ),
      aggregate: vi.fn().mockImplementation(() => Promise.resolve({ _sum: { amount: refundedSum } })),
      create: vi.fn().mockImplementation(({ data }: any) => {
        if (data.status !== "failed") {
          refundedSum += data.amount;
        }
        const refund = { id: `refund-${nextRefundId++}`, ...data };
        refundsByIdempotencyKey.set(data.idempotencyKey, refund);
        return Promise.resolve(refund);
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

    const result = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1");

    expect(result.status).toBe("completed");
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(prisma.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditNoteId: "cn-1",
          invoiceId: "inv-1",
          amount: 100_000n,
          method: "cash",
          idempotencyKey: "idem-1",
        }),
      }),
    );
  });

  it("crée un remboursement payment_link_payout en pending — aucune exécution automatique (Djomy Payout, V2)", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    const result = await service.create(
      "cn-1",
      { amount: 100_000n, method: "payment_link_payout" },
      "user-djenabou",
      "idem-1",
    );

    expect(result.status).toBe("pending");
    expect(result.completedAt).toBeNull();
  });

  it("refuse un remboursement dont le montant dépasse le solde encore remboursable de l'avoir", async () => {
    const prisma = createFakePrisma({ amount: 100_000n });
    const service = new RefundsService(prisma as any);

    await expect(
      service.create("cn-1", { amount: 150_000n, method: "cash" }, "user-djenabou", "idem-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("accepte des remboursements partiels cumulés jusqu'au montant total, refuse le dépassement", async () => {
    // 300 000 au total, 250 000 déjà remboursés — il ne reste que 50 000.
    const prisma = createFakePrisma({}, 250_000n);
    const service = new RefundsService(prisma as any);

    const ok = await service.create("cn-1", { amount: 50_000n, method: "cash" }, "user-djenabou", "idem-1");
    expect(ok.status).toBe("completed");

    await expect(
      service.create("cn-1", { amount: 1n, method: "cash" }, "user-djenabou", "idem-2"),
    ).rejects.toThrow(ConflictException);
  });

  it("un remboursement failed n'est pas compté dans le solde déjà remboursé", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 300_000n, method: "cash" }, "user-djenabou", "idem-1");

    expect(prisma.refund.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "failed" } }) }),
    );
  });

  it("écrit un InvoiceEvent refund_issued avec actorId dans la même transaction", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: { invoiceId: "inv-1", type: "refund_issued", amount: 100_000n, actorId: "user-djenabou" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe("RefundsService.create — idempotence (Security Audit 2026-08-23, finding #2)", () => {
  it("un rejeu avec la même Idempotency-Key renvoie le remboursement déjà créé, sans sur-remboursement", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    const first = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1");
    const replay = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1");

    expect(replay.id).toBe(first.id);
    expect(prisma.refund.create).toHaveBeenCalledTimes(1);
    expect(prisma.creditNote.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it("une violation de contrainte unique concurrente renvoie le remboursement gagnant plutôt qu'une erreur", async () => {
    const prisma = createFakePrisma();
    // Simule deux requêtes concurrentes avec la même clé : la première "gagne" la
    // contrainte unique DB (create() throw P2002), l'autre doit lire son résultat.
    const winner = { id: "refund-winner", idempotencyKey: "idem-race", amount: 100_000n, status: "completed" };
    prisma.refund.create = vi.fn().mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["idempotency_key"] } }),
    );
    prisma.refund.findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // lookup initial : pas encore créé
      .mockResolvedValueOnce(winner); // après l'échec de create() : le gagnant existe déjà

    const service = new RefundsService(prisma as any);

    const result = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-race");

    expect(result).toEqual(winner);
  });
});
