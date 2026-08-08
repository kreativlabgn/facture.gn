import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PaymentProviderName } from "@facture-gn/db";
import type { CreatePaymentLinkResult, PaymentProvider } from "./provider.interface";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { PaymentProviderRegistryService } from "./provider-registry.service";

function buildResult(provider: PaymentProviderName): CreatePaymentLinkResult {
  return {
    provider,
    providerRef: `${provider}-ref`,
    paymentLinkUrl: `https://stub.${provider}/pay`,
    feeGatewayGnf: 0n,
    expiresAt: new Date(),
  };
}

function createProvider(name: PaymentProviderName, behavior: "success" | "timeout" | "fail"): PaymentProvider {
  return {
    name,
    createPaymentLink: vi.fn(async () => {
      if (behavior === "timeout") {
        return new Promise<CreatePaymentLinkResult>(() => {}); // ne résout jamais
      }
      if (behavior === "fail") {
        throw new Error(`${name} indisponible`);
      }
      return buildResult(name);
    }),
    verifyTransaction: vi.fn(),
    handleWebhook: vi.fn(),
  };
}

function createFakePrisma() {
  return {
    paymentProviderAttempt: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

const request = {
  invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
  organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
  amountGnf: 100_000_000n,
};

const SHORT_TIMEOUT_MS = 30; // pas de vraie attente 10s en test

describe("PaymentProviderRegistryService", () => {
  it("retourne le résultat Djomy quand Djomy répond dans les temps", async () => {
    const djomy = createProvider("djomy", "success");
    const moneroo = createProvider("moneroo", "success");
    const prisma = createFakePrisma();
    const registry = new PaymentProviderRegistryService(
      prisma as any,
      new CircuitBreakerService(),
      djomy,
      moneroo,
      SHORT_TIMEOUT_MS,
    );

    const result = await registry.resolve(request);

    expect(result.provider).toBe("djomy");
    expect(moneroo.createPaymentLink).not.toHaveBeenCalled();
  });

  it("bascule vers Moneroo quand Djomy timeout, et trace la tentative Djomy en statut timeout", async () => {
    const djomy = createProvider("djomy", "timeout");
    const moneroo = createProvider("moneroo", "success");
    const prisma = createFakePrisma();
    const registry = new PaymentProviderRegistryService(
      prisma as any,
      new CircuitBreakerService(),
      djomy,
      moneroo,
      SHORT_TIMEOUT_MS,
    );

    const result = await registry.resolve(request);

    expect(result.provider).toBe("moneroo");
    expect(prisma.paymentProviderAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "djomy", status: "timeout" }) }),
    );
  });

  it("bascule vers Moneroo quand Djomy échoue (pas un timeout, une vraie erreur), tracée en statut failed", async () => {
    const djomy = createProvider("djomy", "fail");
    const moneroo = createProvider("moneroo", "success");
    const prisma = createFakePrisma();
    const registry = new PaymentProviderRegistryService(
      prisma as any,
      new CircuitBreakerService(),
      djomy,
      moneroo,
      SHORT_TIMEOUT_MS,
    );

    const result = await registry.resolve(request);

    expect(result.provider).toBe("moneroo");
    expect(prisma.paymentProviderAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "djomy", status: "failed" }) }),
    );
  });

  it("retry Moneroo x2 avant d'abandonner si les deux tentatives échouent", async () => {
    const djomy = createProvider("djomy", "timeout");
    const moneroo = createProvider("moneroo", "fail");
    const prisma = createFakePrisma();
    const registry = new PaymentProviderRegistryService(
      prisma as any,
      new CircuitBreakerService(),
      djomy,
      moneroo,
      SHORT_TIMEOUT_MS,
    );

    await expect(registry.resolve(request)).rejects.toThrow(ServiceUnavailableException);
    expect(moneroo.createPaymentLink).toHaveBeenCalledTimes(2);
  });

  it("trace chaque tentative en base — jamais une tentative silencieuse non tracée", async () => {
    const djomy = createProvider("djomy", "timeout");
    const moneroo = createProvider("moneroo", "fail");
    const prisma = createFakePrisma();
    const registry = new PaymentProviderRegistryService(
      prisma as any,
      new CircuitBreakerService(),
      djomy,
      moneroo,
      SHORT_TIMEOUT_MS,
    );

    await expect(registry.resolve(request)).rejects.toThrow();

    // 1 tentative Djomy (timeout) + 2 tentatives Moneroo (failed) = 3 lignes tracées.
    expect(prisma.paymentProviderAttempt.create).toHaveBeenCalledTimes(3);
  });
});
