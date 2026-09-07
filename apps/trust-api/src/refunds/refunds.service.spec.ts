import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RefundsService } from "./refunds.service";

// organizationScopedClient() appelle `$extends`, et setOrganizationScope() pose le
// GUC via `$executeRaw`. Le vrai client offre les deux ; un faux qui ne les offre
// pas ne teste pas le service migré, il plante dessus. `$extends` rend le client
// LUI-MÊME pour que les mocks de modèle restent partagés et les assertions
// existantes inchangées. `$transaction` bi-forme : la forme tableau est celle
// qu'emploie makeScopedOperation(), ce qui rend l'extension rejouable.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction = p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}

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

  const prisma: any = auClientScope({
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
    // Bi-forme : le callback interactif du service ET la forme tableau
    // qu'emploie makeScopedOperation(), qui rend l'extension rejouable.
    $transaction: vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  });
  return prisma;
}

describe("RefundsService.create (C13, ADR-063)", () => {
  // Le GUC doit être posé en PREMIÈRE ligne de la transaction, sur l'organisation
  // résolue par le RolesGuard. Ici $transaction rappelle le client lui-même, donc
  // $executeRaw porte l'appel à setOrganizationScope().
  it("pose app.current_org_id en tête de la transaction de remboursement", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-1", "idem-scope", "org-a-proteger");

    const setConfig = (prisma as any).$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");

    // Le GUC transactionnel ci-dessus et le CLIENT SCOPÉ sont deux constructions
    // distinctes : muter l'une sans l'autre passerait inaperçu. Les faux
    // `$extends` se renvoyant eux-mêmes, la valeur portée par le client scopé
    // n'est observable qu'en rejouant l'extension capturée.
    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const scopeClient = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(scopeClient.values).toContain("org-a-proteger");
  });


  it("crée un remboursement cash immédiatement completed", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    const result = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1");

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
      "org-1",
    );

    expect(result.status).toBe("pending");
    expect(result.completedAt).toBeNull();
  });

  it("refuse un remboursement dont le montant dépasse le solde encore remboursable de l'avoir", async () => {
    const prisma = createFakePrisma({ amount: 100_000n });
    const service = new RefundsService(prisma as any);

    await expect(
      service.create("cn-1", { amount: 150_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("accepte des remboursements partiels cumulés jusqu'au montant total, refuse le dépassement", async () => {
    // 300 000 au total, 250 000 déjà remboursés — il ne reste que 50 000.
    const prisma = createFakePrisma({}, 250_000n);
    const service = new RefundsService(prisma as any);

    const ok = await service.create("cn-1", { amount: 50_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1");
    expect(ok.status).toBe("completed");

    await expect(
      service.create("cn-1", { amount: 1n, method: "cash" }, "user-djenabou", "idem-2", "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("un remboursement failed n'est pas compté dans le solde déjà remboursé", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 300_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1");

    expect(prisma.refund.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "failed" } }) }),
    );
  });

  it("écrit un InvoiceEvent refund_issued avec actorId dans la même transaction", async () => {
    const prisma = createFakePrisma();
    const service = new RefundsService(prisma as any);

    await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1");

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

    const first = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1");
    const replay = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-1", "org-1");

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
    // Mock greffé APRÈS le constructeur : l'adossement posé par auClientScope()
    // pointerait encore l'ancien. Le service lit par findFirst (règle RLS).
    prisma.refund.findFirst = prisma.refund.findUnique;

    const service = new RefundsService(prisma as any);

    const result = await service.create("cn-1", { amount: 100_000n, method: "cash" }, "user-djenabou", "idem-race", "org-1");

    expect(result).toEqual(winner);
  });
});
