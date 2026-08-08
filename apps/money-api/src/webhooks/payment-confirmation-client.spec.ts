import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentConfirmationClient } from "./payment-confirmation-client";

const request = {
  invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
  amountGnf: 100_000_000n,
  provider: "djomy" as const,
  providerRef: "djomy-stub-3b3963da",
  feeGatewayGnf: 1_000_000n,
};

describe("PaymentConfirmationClient — jamais catché, propage toujours l'échec (contrairement à PaymentLinkClient)", () => {
  beforeEach(() => {
    process.env.TRUST_API_URL = "http://localhost:3000";
    process.env.MONEY_API_INTERNAL_KEY = "secret-partage-de-dev";
  });

  afterEach(() => {
    delete process.env.TRUST_API_URL;
    delete process.env.MONEY_API_INTERNAL_KEY;
    vi.unstubAllGlobals();
  });

  it("résout sans erreur sur une réponse 2xx de trust-api", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201 }));
    const client = new PaymentConfirmationClient();

    await expect(client.confirm(request)).resolves.toBeUndefined();
  });

  it("envoie la clé inter-service et le bon corps à trust-api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new PaymentConfirmationClient();

    await client.confirm(request);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/invoices/3b3963da-d099-43ea-996b-80000060b28a/payments/provider-confirmation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Internal-Api-Key": "secret-partage-de-dev" }),
        body: JSON.stringify({
          amountGnf: "100000000",
          provider: "djomy",
          providerRef: "djomy-stub-3b3963da",
          feeGatewayGnf: "1000000",
        }),
      }),
    );
  });

  it("propage une exception sur une réponse non-2xx — jamais avalée", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = new PaymentConfirmationClient();

    await expect(client.confirm(request)).rejects.toThrow(/500/);
  });

  it("propage une exception réseau — jamais avalée", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = new PaymentConfirmationClient();

    await expect(client.confirm(request)).rejects.toThrow("ECONNREFUSED");
  });

  it("lève une exception explicite si TRUST_API_URL ou MONEY_API_INTERNAL_KEY ne sont pas configurés", async () => {
    delete process.env.TRUST_API_URL;
    const client = new PaymentConfirmationClient();

    await expect(client.confirm(request)).rejects.toThrow(/TRUST_API_URL/);
  });
});
