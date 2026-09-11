import { afterEach, describe, expect, it } from "vitest";
import type { ChargeMobileMoneyRequest, CreatePaymentLinkRequest } from "../provider.interface";import { DjomyStubProvider } from "./djomy-stub.provider";

const request: CreatePaymentLinkRequest = {
  invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
  organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
  amountGnf: 100_000_000n, // 1 000 000 GNF en centimes
  idempotencyKey: "3b3963da-d099-43ea-996b-80000060b28a:djomy",
};

describe("DjomyStubProvider", () => {
  it("génère un lien de paiement déterministe avec 1,4% de frais gateway (ADR-072, corrigé)", async () => {
    const provider = new DjomyStubProvider();

    const result = await provider.createPaymentLink(request);

    expect(result.provider).toBe("djomy");
    expect(result.paymentLinkUrl).toContain(request.invoiceId);
    expect(result.feeGatewayGnf).toBe(1_400_000n); // 1,4% de 100 000 000
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("produit la même référence pour le même invoiceId (déterministe, pas aléatoire)", async () => {
    const provider = new DjomyStubProvider();

    const a = await provider.createPaymentLink(request);
    const b = await provider.createPaymentLink(request);

    expect(a.providerRef).toBe(b.providerRef);
  });

  it("simule un délai configurable, utilisé par les tests du circuit breaker", async () => {
    const provider = new DjomyStubProvider(50);
    const start = Date.now();

    await provider.createPaymentLink(request);

    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
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

describe("DjomyStubProvider — débit Mobile Money poussé (Chantier 3)", () => {
  const chargeRequest: ChargeMobileMoneyRequest = {
    invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
    msisdn: "+224622000000",
    operator: "orange_money",
    amountGnf: 100_000_000n,
    idempotencyKey: "3b3963da-d099-43ea-996b-80000060b28a:charge:+224622000000",
  };

  // ADR-106 — le taux gateway ne dépend pas du canal d'encaissement. Un débit
  // poussé et un lien de paiement sur le même montant doivent coûter la même
  // chose au payeur, sinon le récapitulatif affiché avant le choix ment sur
  // l'un des deux.
  it("applique le même 1,4% que le lien de paiement, sur le même montant", async () => {
    const provider = new DjomyStubProvider();

    const parLien = await provider.createPaymentLink(request);
    const parDebit = await provider.chargeMobileMoney(chargeRequest);

    expect(parDebit.feeGatewayGnf).toBe(1_400_000n); // 1,4% de 100 000 000
    expect(parDebit.feeGatewayGnf).toBe(parLien.feeGatewayGnf);
  });

  // Un débit Mobile Money n'est jamais acquis à l'aller : il attend que le
  // porteur compose son code. Le stub ne s'autorise pas le raccourci d'un
  // "success" immédiat, qui ferait croire à l'écran qu'il peut annoncer un
  // paiement encaissé.
  it("rend toujours 'pending', jamais un succès immédiat", async () => {
    const provider = new DjomyStubProvider();

    const result = await provider.chargeMobileMoney(chargeRequest);

    expect(result.status).toBe("pending");
  });

  it("donne une instruction propre à l'opérateur choisi", async () => {
    const provider = new DjomyStubProvider();

    const orange = await provider.chargeMobileMoney(chargeRequest);
    const mtn = await provider.chargeMobileMoney({ ...chargeRequest, operator: "mtn_momo" });

    expect(orange.instruction).toContain("#144#");
    expect(mtn.instruction).toContain("MoMo");
    expect(orange.instruction).not.toBe(mtn.instruction);
  });

  // La référence porte la clé d'idempotence : deux débits pour le même couple
  // (facture, numéro) sont reconnaissables comme le même geste, ce qui est ce
  // que la garde de double-débit exploitera côté service.
  it("dérive la référence provider de la clé d'idempotence", async () => {
    const provider = new DjomyStubProvider();

    const a = await provider.chargeMobileMoney(chargeRequest);
    const b = await provider.chargeMobileMoney(chargeRequest);

    expect(a.providerRef).toBe(b.providerRef);
    expect(a.providerRef).toContain(chargeRequest.idempotencyKey);
  });
});
