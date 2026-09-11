import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconciliationService } from "./reconciliation.service";

const HOURS_2_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    invoiceId: "inv-1",
    provider: "djomy",
    status: "pending",
    providerRef: "DJOMY-TX-1",
    amountGnf: 5_000_000_00n,
    feeGateway: 175_000_00n,
    createdAt: HOURS_2_AGO,
    ...overrides,
  };
}

function build(opts: {
  stale?: unknown[];
  verify?: (ref: string) => Promise<{ status: string; providerRef: string; settledAt?: Date }>;
  confirm?: () => Promise<void>;
  resolveNull?: boolean;
}) {
const prisma = {
      paymentProviderAttempt: {
        findMany: vi.fn().mockResolvedValue(opts.stale ?? [attempt()]),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentWebhook: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
  const provider = {
    name: "djomy",
    verifyTransaction: vi.fn(opts.verify ?? (async (ref: string) => ({ status: "pending", providerRef: ref }))),
  };
  const providerResolver = { resolve: vi.fn(() => (opts.resolveNull ? null : provider)) };
  const confirmationClient = { confirm: vi.fn(opts.confirm ?? (async () => undefined)) };
  const service = new ReconciliationService(prisma as never, providerResolver as never, confirmationClient as never);
  return { service, prisma, provider, providerResolver, confirmationClient };
}

afterEach(() => {
  delete process.env.RECONCILIATION_STALE_MINUTES;
});

describe("ReconciliationService.runOnce", () => {
  it("ne requête que les tentatives pending/timeout, anciennes, avec un providerRef", async () => {
    const { service, prisma } = build({});
    await service.runOnce();

    const where = (prisma.paymentProviderAttempt.findMany as any).mock.calls[0][0].where;
    expect(where.status.in).toEqual(["pending", "timeout"]);
    expect(where.providerRef).toEqual({ not: null });
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("confirme un paiement quand le provider répond success (idempotent côté trust-api)", async () => {
    const { service, prisma, confirmationClient } = build({
      verify: async (ref) => ({ status: "success", providerRef: ref, settledAt: new Date("2026-03-12T15:00:00Z") }),
    });

    const summary = await service.runOnce();

    expect(prisma.paymentProviderAttempt.update).toHaveBeenCalledWith({
      where: { id: "att-1" },
      data: { status: "success", settledAt: new Date("2026-03-12T15:00:00Z") },
    });
    expect(confirmationClient.confirm).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountGnf: 5_000_000_00n,
      provider: "djomy",
      providerRef: "DJOMY-TX-1",
      feeGatewayGnf: 175_000_00n,
    });
    expect(summary).toMatchObject({ checked: 1, confirmed: 1, failed: 0, stillPending: 0 });
  });

  it("marque la tentative failed quand le provider répond failed, sans confirmer", async () => {
    const { service, prisma, confirmationClient } = build({
      verify: async (ref) => ({ status: "failed", providerRef: ref }),
    });

    const summary = await service.runOnce();

    expect(prisma.paymentProviderAttempt.update).toHaveBeenCalledWith({
      where: { id: "att-1" },
      data: { status: "failed" },
    });
    expect(confirmationClient.confirm).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ failed: 1, confirmed: 0 });
  });

  it("laisse une tentative encore pending intacte", async () => {
    const { service, prisma, confirmationClient } = build({
      verify: async (ref) => ({ status: "pending", providerRef: ref }),
    });

    const summary = await service.runOnce();

    expect(prisma.paymentProviderAttempt.update).not.toHaveBeenCalled();
    expect(confirmationClient.confirm).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ stillPending: 1 });
  });

  it("un échec de confirm() est compté et loggé, jamais propagé — les autres tentatives continuent", async () => {
    const { service, confirmationClient } = build({
      stale: [attempt({ id: "att-1" }), attempt({ id: "att-2", providerRef: "DJOMY-TX-2" })],
      verify: async (ref) => ({ status: "success", providerRef: ref }),
      confirm: vi.fn().mockRejectedValueOnce(new Error("trust-api 503")).mockResolvedValue(undefined),
    });

    const summary = await service.runOnce();

    expect(confirmationClient.confirm).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ checked: 2, confirmed: 1, errored: 1 });
  });

  it("si confirm() échoue, l'attempt reste pending (jamais marqué success) — reprise au prochain tick", async () => {
    const { service, prisma } = build({
      verify: async (ref) => ({ status: "success", providerRef: ref }),
      confirm: vi.fn().mockRejectedValue(new Error("trust-api down")),
    });

    await service.runOnce();

    expect(prisma.paymentProviderAttempt.update).not.toHaveBeenCalled();
  });

  it("une API provider en erreur sur une tentative n'interrompt pas le lot", async () => {
    const { service, confirmationClient } = build({
      stale: [attempt({ id: "att-1" }), attempt({ id: "att-2", providerRef: "DJOMY-TX-2" })],
      verify: vi
        .fn()
        .mockRejectedValueOnce(new Error("Djomy timeout"))
        .mockResolvedValue({ status: "failed", providerRef: "DJOMY-TX-2" }),
    });

    const summary = await service.runOnce();

    expect(summary).toMatchObject({ checked: 2, errored: 1, failed: 1 });
    expect(confirmationClient.confirm).not.toHaveBeenCalled();
  });

  it("saute une tentative dont le provider n'est pas résolu", async () => {
    const { service, provider } = build({ resolveNull: true });
    const summary = await service.runOnce();
    expect(provider.verifyTransaction).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ skipped: 1 });
  });

  it("respecte RECONCILIATION_STALE_MINUTES pour le seuil d'ancienneté", async () => {
    process.env.RECONCILIATION_STALE_MINUTES = "10";
    const { service, prisma } = build({});
    await service.runOnce();
    const cutoff = (prisma.paymentProviderAttempt.findMany as any).mock.calls[0][0].where.createdAt.lt as Date;
    // ~10 min dans le passé (tolérance large)
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(9 * 60 * 1000);
    expect(Date.now() - cutoff.getTime()).toBeLessThan(11 * 60 * 1000);
  });
});
