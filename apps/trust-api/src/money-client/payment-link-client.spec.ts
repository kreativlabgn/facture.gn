import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentLinkClient } from "./payment-link-client";

const request = {
  invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
  organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
  amountGnf: 100_000_000n,
};

describe("PaymentLinkClient", () => {
  beforeEach(() => {
    process.env.MONEY_API_URL = "http://localhost:3001";
    process.env.MONEY_API_INTERNAL_KEY = "secret-partage-de-dev";
  });

  afterEach(() => {
    delete process.env.MONEY_API_URL;
    delete process.env.MONEY_API_INTERNAL_KEY;
    vi.unstubAllGlobals();
  });

  it("retourne le lien de paiement sur une réponse 2xx de money-api", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          provider: "djomy",
          providerRef: "djomy-stub-3b3963da",
          paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-stub-3b3963da",
          expiresAt: "2026-09-07T00:00:00.000Z",
        }),
      }),
    );
    const client = new PaymentLinkClient();

    const result = await client.tryGenerate(request);

    expect(result).toEqual({
      paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-stub-3b3963da",
      providerRef: "djomy-stub-3b3963da",
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
    });
  });

  it("envoie la clé inter-service en en-tête", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        provider: "djomy",
        providerRef: "ref",
        paymentLinkUrl: "https://stub.djomy.africa/pay/ref",
        expiresAt: "2026-09-07T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new PaymentLinkClient();

    await client.tryGenerate(request);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/payment-links",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Internal-Api-Key": "secret-partage-de-dev" }),
      }),
    );
  });

  it("retourne null (jamais un throw) sur une réponse non-2xx de money-api", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const client = new PaymentLinkClient();

    await expect(client.tryGenerate(request)).resolves.toBeNull();
  });

  it("retourne null (jamais un throw) sur une exception réseau", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = new PaymentLinkClient();

    await expect(client.tryGenerate(request)).resolves.toBeNull();
  });

  it("retourne null (jamais un throw) sur un timeout (AbortError)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
    );
    const client = new PaymentLinkClient();

    await expect(client.tryGenerate(request)).resolves.toBeNull();
  });

  it("retourne null sans appeler fetch si MONEY_API_URL ou MONEY_API_INTERNAL_KEY ne sont pas configurés", async () => {
    delete process.env.MONEY_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new PaymentLinkClient();

    const result = await client.tryGenerate(request);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
