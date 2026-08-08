import { describe, expect, it } from "vitest";
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
