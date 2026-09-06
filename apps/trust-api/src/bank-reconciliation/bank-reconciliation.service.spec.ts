import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { fingerprint } from "./bank-matching";
import { BankReconciliationService } from "./bank-reconciliation.service";

const ORG = "org-1";
const USER = "usr-7";

type Row = Record<string, any>;

// Fake Prisma à état mutable pour bank_transaction : nécessaire pour prouver la
// séquence revendiquer → payer → poser matchedPaymentId (et l'annulation).
function createFakePrisma(opts: { invoices?: Row[] } = {}) {
  const txById = new Map<string, Row>();
  const txByFingerprint = new Map<string, Row>();
  let nextId = 1;

  function p2002(field: string) {
    return Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: [field] },
    });
  }

  const prisma: any = {
    __txById: txById,
    bankTransaction: {
      create: vi.fn(({ data }: any) => {
        if (txByFingerprint.has(data.fingerprint)) {
          return Promise.reject(p2002("fingerprint"));
        }
        const row: Row = {
          id: `bt-${nextId++}`,
          state: "unmatched",
          matchedInvoiceId: null,
          matchedPaymentId: null,
          resolvedByUserId: null,
          resolvedAt: null,
          counterpartyLabel: null,
          bankRef: null,
          ...data,
        };
        txById.set(row.id, row);
        txByFingerprint.set(row.fingerprint, row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(({ where }: any) => {
        if (where.id) return Promise.resolve(txById.get(where.id) ?? null);
        if (where.fingerprint) return Promise.resolve(txByFingerprint.get(where.fingerprint) ?? null);
        return Promise.resolve(null);
      }),
      findUniqueOrThrow: vi.fn(({ where }: any) => {
        const row = txById.get(where.id);
        if (!row) return Promise.reject(new Error("not found"));
        return Promise.resolve(row);
      }),
      // Honore la DOUBLE CLAUSE, pas seulement l'id : c'est ce qui rend le test
      // discriminant si organizationId venait à disparaître du `where`.
      findFirstOrThrow: vi.fn(({ where }: any) => {
        const row = txById.get(where.id);
        if (!row || (where.organizationId && row.organizationId !== where.organizationId)) {
          return Promise.reject(new Error("not found"));
        }
        return Promise.resolve(row);
      }),
      // Deux lectures findFirst distinctes passent ici : par id (confirmMatch)
      // et par empreinte (relecture du doublon dans importTransactions). Les deux
      // honorent la clause d'organisation.
      findFirst: vi.fn(({ where }: any) => {
        const row = where.id ? txById.get(where.id) : txByFingerprint.get(where.fingerprint);
        if (!row || (where.organizationId && row.organizationId !== where.organizationId)) {
          return Promise.resolve(null);
        }
        return Promise.resolve(row);
      }),
      findMany: vi.fn(({ where = {}, take, skip }: any) => {
        let rows = [...txById.values()].filter((r) => {
          if (where.organizationId && r.organizationId !== where.organizationId) return false;
          if (where.state && r.state !== where.state) return false;
          if (where.importBatchId && r.importBatchId !== where.importBatchId) return false;
          return true;
        });
        rows = rows.sort((a, b) => b.valueDate.getTime() - a.valueDate.getTime());
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return Promise.resolve(rows);
      }),
      updateMany: vi.fn(({ where, data }: any) => {
        let count = 0;
        for (const row of txById.values()) {
          if (where.id && row.id !== where.id) continue;
          if (where.organizationId && row.organizationId !== where.organizationId) continue;
          if (where.state && row.state !== where.state) continue;
          Object.assign(row, data);
          count += 1;
        }
        return Promise.resolve({ count });
      }),
      update: vi.fn(({ where, data }: any) => {
        const row = txById.get(where.id);
        if (!row) return Promise.reject(new Error("not found"));
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    invoice: {
      findMany: vi.fn(() => Promise.resolve(opts.invoices ?? [])),
      findUnique: vi.fn(({ where }: any) => {
        const inv = (opts.invoices ?? []).find((i) => i.id === where.id);
        return Promise.resolve(inv ? { organizationId: inv.organizationId ?? ORG, ...inv } : null);
      }),
      // confirmMatch() lit la facture par double clause : le faux applique
      // RÉELLEMENT le filtre d'organisation, sans quoi le test d'IDOR
      // (« facture d'une autre organisation ») ne prouverait plus rien.
      findFirst: vi.fn(({ where }: any) => {
        const inv = (opts.invoices ?? []).find((i) => i.id === where.id);
        if (!inv) return Promise.resolve(null);
        const organizationId = inv.organizationId ?? ORG;
        if (where.organizationId && organizationId !== where.organizationId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ organizationId, ...inv });
      }),
    },
    // organizationScopedClient() appelle $extends ; il rend le client LUI-MÊME,
    // pour que les mocks à état mutable ci-dessus restent partagés.
    $extends: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  };
  prisma.$extends.mockReturnValue(prisma);
  return prisma;
}

function createFakePayments(over: Partial<Record<string, any>> = {}) {
  return {
    recordBankTransferPayment: vi.fn(() => Promise.resolve({ id: "pay-1" })),
    ...over,
  } as any;
}

describe("BankReconciliationService.importTransactions", () => {
  it("persiste chaque ligne avec son empreinte ; retour imported: N", async () => {
    const prisma = createFakePrisma();
    const service = new BankReconciliationService(prisma, createFakePayments());

    const result = await service.importTransactions(
      ORG,
      {
        transactions: [
          { valueDate: new Date("2026-08-20"), amountCentimes: 1_500_000n, rawLabel: "VIR A" },
          { valueDate: new Date("2026-08-21"), amountCentimes: 2_000_000n, rawLabel: "VIR B" },
        ],
      },
      USER,
    );

    expect(result.imported).toBe(2);
    expect(result.duplicate).toBe(0);
    expect(result.results).toHaveLength(2);
    const created = prisma.bankTransaction.create.mock.calls[0][0].data;
    expect(created.fingerprint).toBe(
      fingerprint({
        organizationId: ORG,
        valueDate: new Date("2026-08-20"),
        amountCentimes: 1_500_000n,
        rawLabel: "VIR A",
      }),
    );
    expect(created.importedByUserId).toBe(USER);
  });

  it("une erreur non-P2002 du create remonte, jamais avalée comme un doublon", async () => {
    const prisma = createFakePrisma();
    prisma.bankTransaction.create = vi.fn(() => Promise.reject(new Error("connexion DB perdue")));
    const service = new BankReconciliationService(prisma, createFakePayments());

    await expect(
      service.importTransactions(
        ORG,
        { transactions: [{ valueDate: new Date("2026-08-20"), amountCentimes: 1n, rawLabel: "x" }] },
        USER,
      ),
    ).rejects.toThrow("connexion DB perdue");
  });

  it("ré-importe la même ligne (même empreinte, P2002) → duplicate, aucun doublon", async () => {
    const prisma = createFakePrisma();
    const service = new BankReconciliationService(prisma, createFakePayments());
    const row = { valueDate: new Date("2026-08-20"), amountCentimes: 1_500_000n, rawLabel: "VIR A" };

    await service.importTransactions(ORG, { transactions: [row] }, USER);
    const second = await service.importTransactions(ORG, { transactions: [row] }, USER);

    expect(second.imported).toBe(0);
    expect(second.duplicate).toBe(1);
    expect(second.results[0].status).toBe("duplicate");
    expect(prisma.__txById.size).toBe(1);
  });

  it("toutes les lignes d'un import partagent le même importBatchId", async () => {
    const prisma = createFakePrisma();
    const service = new BankReconciliationService(prisma, createFakePayments());

    const result = await service.importTransactions(
      ORG,
      {
        transactions: [
          { valueDate: new Date("2026-08-20"), amountCentimes: 100n, rawLabel: "A" },
          { valueDate: new Date("2026-08-20"), amountCentimes: 200n, rawLabel: "B" },
        ],
      },
      USER,
    );

    const batchIds = new Set(
      prisma.bankTransaction.create.mock.calls.map((c: any) => c[0].data.importBatchId),
    );
    expect(batchIds).toEqual(new Set([result.importBatchId]));
  });
});

describe("BankReconciliationService.listTransactions", () => {
  const payableInvoice = {
    id: "inv-1",
    organizationId: ORG,
    number: "FG-2026-000042",
    certificationId: null,
    amountDue: 1_500_000n,
    issuedAt: new Date("2026-08-01"),
    status: "issued",
  };

  it("un seul invoice.findMany quel que soit le nombre de transactions unmatched (pas de N+1)", async () => {
    const prisma = createFakePrisma({ invoices: [payableInvoice] });
    const service = new BankReconciliationService(prisma, createFakePayments());
    await service.importTransactions(
      ORG,
      {
        transactions: [
          { valueDate: new Date("2026-08-10"), amountCentimes: 1_500_000n, rawLabel: "VIR FG-2026-000042" },
          { valueDate: new Date("2026-08-11"), amountCentimes: 1_500_000n, rawLabel: "autre" },
          { valueDate: new Date("2026-08-12"), amountCentimes: 1_500_000n, rawLabel: "encore" },
        ],
      },
      USER,
    );

    const result = await service.listTransactions(ORG, {});

    expect(prisma.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
    expect(result[0].suggestions.length).toBeGreaterThan(0);
  });

  it("ne suggère QUE des factures payables (issued / partially_paid), jamais draft/paid/voided", async () => {
    const prisma = createFakePrisma({ invoices: [payableInvoice] });
    const service = new BankReconciliationService(prisma, createFakePayments());
    await service.importTransactions(
      ORG,
      { transactions: [{ valueDate: new Date("2026-08-10"), amountCentimes: 1_500_000n, rawLabel: "x" }] },
      USER,
    );

    await service.listTransactions(ORG, {});

    const where = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.status.in).toEqual(expect.arrayContaining(["issued", "partially_paid"]));
    expect(where.status.in).not.toContain("draft");
    expect(where.status.in).not.toContain("paid");
  });

  it("aucune suggestion attachée aux transactions non-unmatched", async () => {
    const prisma = createFakePrisma({ invoices: [payableInvoice] });
    const service = new BankReconciliationService(prisma, createFakePayments());
    await service.importTransactions(
      ORG,
      { transactions: [{ valueDate: new Date("2026-08-10"), amountCentimes: 1_500_000n, rawLabel: "x" }] },
      USER,
    );
    const [tx] = [...prisma.__txById.values()];
    tx.state = "ignored";
    tx.resolvedByUserId = USER;
    tx.resolvedAt = new Date();

    const result = await service.listTransactions(ORG, {});

    expect(result[0].suggestions).toEqual([]);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe("BankReconciliationService.confirmMatch", () => {
  // Les faux `$extends` de ce dépôt se renvoient eux-mêmes : la VALEUR du scope
  // n'est pas observable directement. On rejoue donc l'extension capturée —
  // `$allOperations` exécute le set_config via `$executeRaw` — pour lire
  // l'organisation qui y a été injectée.
  it("pose le scope RLS de l'organisation appelante, jamais une autre", async () => {
    const prisma = createFakePrisma();
    const service = new BankReconciliationService(prisma, createFakePayments());

    await service.listTransactions(ORG, {} as any);

    const extension = prisma.$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = prisma.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain(ORG);
  });


  const invoices = [{ id: "inv-1", organizationId: ORG }];

  async function seedUnmatched(prisma: any) {
    const service = new BankReconciliationService(prisma, createFakePayments());
    await service.importTransactions(
      ORG,
      { transactions: [{ valueDate: new Date("2026-08-10"), amountCentimes: 1_500_000n, rawLabel: "x" }] },
      USER,
    );
    return [...prisma.__txById.values()][0].id as string;
  }

  it("revendique la transaction (state → matched) AVANT d'appeler recordBankTransferPayment", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    const payments = createFakePayments({
      recordBankTransferPayment: vi.fn(() => {
        // au moment de l'appel au paiement, la transaction est déjà revendiquée
        expect(prisma.__txById.get(txId).state).toBe("matched");
        return Promise.resolve({ id: "pay-99" });
      }),
    });
    const service = new BankReconciliationService(prisma, payments);

    const { transaction, payment } = await service.confirmMatch(ORG, txId, "inv-1", USER);

    expect(payments.recordBankTransferPayment).toHaveBeenCalledWith(
      "inv-1",
      ORG,
      { amount: 1_500_000n },
      `bank-reconciliation:${txId}`,
    );
    expect(payment.id).toBe("pay-99");
    expect(transaction.matchedPaymentId).toBe("pay-99");
    expect(transaction.resolvedByUserId).toBe(USER);
  });

  it("recordBankTransferPayment lève → la revendication est annulée (retour à unmatched), l'exception remonte", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    const boom = new ConflictException("facture non payable");
    const payments = createFakePayments({
      recordBankTransferPayment: vi.fn(() => Promise.reject(boom)),
    });
    const service = new BankReconciliationService(prisma, payments);

    await expect(service.confirmMatch(ORG, txId, "inv-1", USER)).rejects.toBe(boom);

    const row = prisma.__txById.get(txId);
    expect(row.state).toBe("unmatched");
    expect(row.matchedInvoiceId).toBeNull();
    expect(row.matchedPaymentId).toBeNull();
    expect(row.resolvedByUserId).toBeNull();
  });

  it("reprend un confirm interrompu (matched vers la bonne facture, sans matchedPaymentId)", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    // état laissé par une étape 3 interrompue
    Object.assign(prisma.__txById.get(txId), {
      state: "matched",
      matchedInvoiceId: "inv-1",
      matchedPaymentId: null,
      resolvedByUserId: USER,
      resolvedAt: new Date(),
    });
    const payments = createFakePayments({
      recordBankTransferPayment: vi.fn(() => Promise.resolve({ id: "pay-existant" })),
    });
    const service = new BankReconciliationService(prisma, payments);

    const { transaction } = await service.confirmMatch(ORG, txId, "inv-1", USER);

    expect(transaction.matchedPaymentId).toBe("pay-existant");
    expect(payments.recordBankTransferPayment).toHaveBeenCalledTimes(1);
  });

  it("matched vers une AUTRE facture → ConflictException, pas de reprise", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    Object.assign(prisma.__txById.get(txId), {
      state: "matched",
      matchedInvoiceId: "inv-autre",
      matchedPaymentId: null,
      resolvedByUserId: USER,
      resolvedAt: new Date(),
    });
    const payments = createFakePayments();
    const service = new BankReconciliationService(prisma, payments);

    await expect(service.confirmMatch(ORG, txId, "inv-1", USER)).rejects.toThrow(ConflictException);
    expect(payments.recordBankTransferPayment).not.toHaveBeenCalled();
  });

  it("si l'annulation de la revendication échoue, l'erreur métier d'origine remonte quand même", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    const businessError = new ConflictException("montant supérieur au solde dû");
    const payments = createFakePayments({
      recordBankTransferPayment: vi.fn(() => Promise.reject(businessError)),
    });
    // la compensation (2ᵉ updateMany) explose
    let updateManyCalls = 0;
    const realUpdateMany = prisma.bankTransaction.updateMany;
    prisma.bankTransaction.updateMany = vi.fn((args: any) => {
      updateManyCalls += 1;
      if (updateManyCalls >= 2) return Promise.reject(new Error("DB indisponible"));
      return realUpdateMany(args);
    });
    const service = new BankReconciliationService(prisma, payments);

    await expect(service.confirmMatch(ORG, txId, "inv-1", USER)).rejects.toBe(businessError);
  });

  it("transaction déjà matched → ConflictException, aucun appel à recordBankTransferPayment", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    prisma.__txById.get(txId).state = "matched";
    const payments = createFakePayments();
    const service = new BankReconciliationService(prisma, payments);

    await expect(service.confirmMatch(ORG, txId, "inv-1", USER)).rejects.toThrow(ConflictException);
    expect(payments.recordBankTransferPayment).not.toHaveBeenCalled();
  });

  it("transaction d'une autre organisation → NotFoundException (garde organizationId)", async () => {
    const prisma = createFakePrisma({ invoices });
    const txId = await seedUnmatched(prisma);
    const service = new BankReconciliationService(prisma, createFakePayments());

    await expect(service.confirmMatch("autre-org", txId, "inv-1", USER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("facture d'une autre organisation → NotFoundException, jamais déléguée au paiement", async () => {
    const prisma = createFakePrisma({ invoices: [{ id: "inv-x", organizationId: "autre-org" }] });
    const txId = await seedUnmatched(prisma);
    const payments = createFakePayments();
    const service = new BankReconciliationService(prisma, payments);

    await expect(service.confirmMatch(ORG, txId, "inv-x", USER)).rejects.toThrow(NotFoundException);
    expect(payments.recordBankTransferPayment).not.toHaveBeenCalled();
  });
});

describe("BankReconciliationService.ignoreTransaction", () => {
  it("unmatched → ignored", async () => {
    const prisma = createFakePrisma();
    const service = new BankReconciliationService(prisma, createFakePayments());
    await service.importTransactions(
      ORG,
      { transactions: [{ valueDate: new Date("2026-08-10"), amountCentimes: 100n, rawLabel: "x" }] },
      USER,
    );
    const txId = [...prisma.__txById.values()][0].id;

    const result = await service.ignoreTransaction(ORG, txId, USER);

    expect(result.state).toBe("ignored");
    expect(result.resolvedByUserId).toBe(USER);
  });

  it("déjà résolue → ConflictException", async () => {
    const prisma = createFakePrisma();
    const service = new BankReconciliationService(prisma, createFakePayments());
    await service.importTransactions(
      ORG,
      { transactions: [{ valueDate: new Date("2026-08-10"), amountCentimes: 100n, rawLabel: "x" }] },
      USER,
    );
    const txId = [...prisma.__txById.values()][0].id;
    prisma.__txById.get(txId).state = "matched";

    await expect(service.ignoreTransaction(ORG, txId, USER)).rejects.toThrow(ConflictException);
  });
});
