import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedWebhookResult, PaymentProvider } from "../payment-orchestrator/provider.interface";
import { WebhooksService } from "./webhooks.service";

function createFakeProvider(result: NormalizedWebhookResult): PaymentProvider {
  return {
    name: "djomy",
    createPaymentLink: vi.fn(),
    verifyTransaction: vi.fn(),
    handleWebhook: vi.fn().mockReturnValue(result),
  };
}

function createFakeResolver(provider: PaymentProvider | null) {
  return { resolve: vi.fn().mockReturnValue(provider) };
}

function createFakeConfirmationClient(behavior: "success" | "fail" = "success") {
  return {
    confirm: vi.fn().mockImplementation(() => {
      if (behavior === "fail") {
        return Promise.reject(new Error("trust-api a répondu 500"));
      }
      return Promise.resolve();
    }),
  };
}

function createFakePrisma(overrides: { paymentWebhook?: any; paymentProviderAttempt?: any } = {}) {
  return {
    paymentWebhook: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      ...overrides.paymentWebhook,
    },
    paymentProviderAttempt: {
      findFirst: vi.fn().mockResolvedValue({
        invoiceId: "inv-1",
        amountGnf: 100_000_000n,
        feeGateway: 1_000_000n,
      }),
      ...overrides.paymentProviderAttempt,
    },
  };
}

const paidResult: NormalizedWebhookResult = {
  providerRef: "djomy-stub-inv-1",
  status: "paid",
  signatureValid: true,
};

describe("WebhooksService", () => {
  it("rejette une signature invalide sans jamais appeler trust-api ni insérer de ligne", async () => {
    const provider = createFakeProvider({ ...paidResult, signatureValid: false });
    const resolver = createFakeResolver(provider);
    const confirmationClient = createFakeConfirmationClient();
    const prisma = createFakePrisma();
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await expect(service.handleIncomingWebhook("djomy", { provider_ref: "x" })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(confirmationClient.confirm).not.toHaveBeenCalled();
    expect(prisma.paymentWebhook.create).not.toHaveBeenCalled();
  });

  it("rejette un provider inconnu (orange_direct/mtn_direct, pas encore implémenté)", async () => {
    const resolver = createFakeResolver(null);
    const confirmationClient = createFakeConfirmationClient();
    const prisma = createFakePrisma();
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await expect(service.handleIncomingWebhook("orange_direct", {})).rejects.toThrow(BadRequestException);
  });

  it("un webhook déjà traité (ligne existante) est un no-op — ne rappelle jamais trust-api", async () => {
    const provider = createFakeProvider(paidResult);
    const resolver = createFakeResolver(provider);
    const confirmationClient = createFakeConfirmationClient();
    const prisma = createFakePrisma({
      paymentWebhook: { findUnique: vi.fn().mockResolvedValue({ id: "webhook-1" }) },
    });
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await service.handleIncomingWebhook("djomy", { provider_ref: "djomy-stub-inv-1" });

    expect(confirmationClient.confirm).not.toHaveBeenCalled();
    expect(prisma.paymentWebhook.create).not.toHaveBeenCalled();
  });

  it("providerRef inconnu (aucun PaymentProviderAttempt correspondant) est rejeté proprement, jamais un 500 brut", async () => {
    const provider = createFakeProvider(paidResult);
    const resolver = createFakeResolver(provider);
    const confirmationClient = createFakeConfirmationClient();
    const prisma = createFakePrisma({
      paymentProviderAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await expect(service.handleIncomingWebhook("djomy", { provider_ref: "inconnu" })).rejects.toThrow(
      BadRequestException,
    );
    expect(confirmationClient.confirm).not.toHaveBeenCalled();
  });

  it("status paid avec confirmation trust-api réussie → insère la ligne PaymentWebhook", async () => {
    const provider = createFakeProvider(paidResult);
    const resolver = createFakeResolver(provider);
    const confirmationClient = createFakeConfirmationClient("success");
    const prisma = createFakePrisma();
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await service.handleIncomingWebhook("djomy", { provider_ref: "djomy-stub-inv-1" });

    expect(confirmationClient.confirm).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountGnf: 100_000_000n,
      provider: "djomy",
      providerRef: "djomy-stub-inv-1",
      feeGatewayGnf: 1_000_000n,
    });
    expect(prisma.paymentWebhook.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "djomy",
          providerRef: "djomy-stub-inv-1",
          normalizedStatus: "paid",
          signatureValid: true,
        }),
      }),
    );
  });

  it("status paid avec échec de confirmation trust-api → propage l'échec, N'insère PAS la ligne (pour permettre la redélivraison)", async () => {
    const provider = createFakeProvider(paidResult);
    const resolver = createFakeResolver(provider);
    const confirmationClient = createFakeConfirmationClient("fail");
    const prisma = createFakePrisma();
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await expect(service.handleIncomingWebhook("djomy", { provider_ref: "djomy-stub-inv-1" })).rejects.toThrow(
      "trust-api a répondu 500",
    );
    expect(prisma.paymentWebhook.create).not.toHaveBeenCalled();
  });

  it("status pending/failed insère directement pour audit, sans jamais appeler trust-api", async () => {
    const provider = createFakeProvider({ providerRef: "djomy-stub-inv-2", status: "pending", signatureValid: true });
    const resolver = createFakeResolver(provider);
    const confirmationClient = createFakeConfirmationClient();
    const prisma = createFakePrisma();
    const service = new WebhooksService(prisma as any, resolver as any, confirmationClient as any);

    await service.handleIncomingWebhook("djomy", { provider_ref: "djomy-stub-inv-2" });

    expect(confirmationClient.confirm).not.toHaveBeenCalled();
    expect(prisma.paymentWebhook.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ normalizedStatus: "pending" }) }),
    );
  });
});
