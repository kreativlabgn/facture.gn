import { afterEach, describe, expect, it } from "vitest";
import type { CreatePaymentLinkRequest } from "../provider.interface";
import { DjomyStubProvider } from "./djomy-stub.provider";

const request: CreatePaymentLinkRequest = {
  invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
  organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
  amountGnf: 100_000_000n, // 1 000 000 GNF en centimes
  idempotencyKey: "3b3963da-d099-43ea-996b-80000060b28a:djomy",
};

describe("DjomyStubProvider", () => {
  it("génère un lien de paiement déterministe avec 1% de frais gateway (ADR-072)", async () => {
    const provider = new DjomyStubProvider();

    const result = await provider.createPaymentLink(request);

    expect(result.provider).toBe("djomy");
    expect(result.paymentLinkUrl).toContain(request.invoiceId);
    expect(result.feeGatewayGnf).toBe(1_000_000n); // 1% de 100 000 000
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("produit la même référence pour le même invoiceId (déterministe, pas aléatoire)", async () => {
    const provider = new DjomyStubProvider();

    const a = await provider.createPaymentLink(request);
    const b = await provider.createPaymentLink(request);

    expect(a.providerRef).toBe(b.providerRef);
  });

  it("simule un délai configurable, utilisé par les tests du circuit breaker", async () => {
    const provider = new DjomyStubProvider(30);
    const start = Date.now();

    await provider.createPaymentLink(request);

    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});

describe("DjomyStubProvider — handleWebhook (garde contre la forgerie, C2 Phase 2b)", () => {
  afterEach(() => {
    delete process.env.DJOMY_WEBHOOK_STUB_SECRET;
  });

  it("rejette (signatureValid: false) un webhook sans stub_secret — n'importe qui connaît le provider_ref (visible dans l'URL du lien envoyée au client)", () => {
    process.env.DJOMY_WEBHOOK_STUB_SECRET = "secret-dev-djomy";
    const provider = new DjomyStubProvider();

    const result = provider.handleWebhook({ provider_ref: "djomy-stub-inv-1" });

    expect(result.signatureValid).toBe(false);
  });

  it("rejette un stub_secret incorrect", () => {
    process.env.DJOMY_WEBHOOK_STUB_SECRET = "secret-dev-djomy";
    const provider = new DjomyStubProvider();

    const result = provider.handleWebhook({ provider_ref: "djomy-stub-inv-1", stub_secret: "mauvais" });

    expect(result.signatureValid).toBe(false);
  });

  it("accepte le stub_secret exact", () => {
    process.env.DJOMY_WEBHOOK_STUB_SECRET = "secret-dev-djomy";
    const provider = new DjomyStubProvider();

    const result = provider.handleWebhook({ provider_ref: "djomy-stub-inv-1", stub_secret: "secret-dev-djomy" });

    expect(result.signatureValid).toBe(true);
    expect(result.status).toBe("paid");
  });

  it("rejette par défaut (fail-closed) si DJOMY_WEBHOOK_STUB_SECRET n'est pas configuré — jamais un accès ouvert par oubli", () => {
    delete process.env.DJOMY_WEBHOOK_STUB_SECRET;
    const provider = new DjomyStubProvider();

    const result = provider.handleWebhook({ provider_ref: "djomy-stub-inv-1", stub_secret: "peu-importe" });

    expect(result.signatureValid).toBe(false);
  });
});
