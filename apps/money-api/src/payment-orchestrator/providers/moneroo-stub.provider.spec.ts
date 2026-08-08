import { describe, expect, it } from "vitest";
import type { CreatePaymentLinkRequest } from "../provider.interface";
import { MonerooStubProvider } from "./moneroo-stub.provider";

const request: CreatePaymentLinkRequest = {
  invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
  organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
  amountGnf: 100_000_000n,
  idempotencyKey: "3b3963da-d099-43ea-996b-80000060b28a:moneroo",
};

describe("MonerooStubProvider", () => {
  it("génère un lien de paiement déterministe (fallback, pas de frais gateway 1% Djomy)", async () => {
    const provider = new MonerooStubProvider();

    const result = await provider.createPaymentLink(request);

    expect(result.provider).toBe("moneroo");
    expect(result.paymentLinkUrl).toContain(request.invoiceId);
    expect(result.feeGatewayGnf).toBe(0n);
  });

  it("simule un délai configurable, utilisé par les tests de retry", async () => {
    const provider = new MonerooStubProvider(30);
    const start = Date.now();

    await provider.createPaymentLink(request);

    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});
