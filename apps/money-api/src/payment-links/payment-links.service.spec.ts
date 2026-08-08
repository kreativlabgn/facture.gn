import { describe, expect, it, vi } from "vitest";
import { PaymentLinksService } from "./payment-links.service";

describe("PaymentLinksService", () => {
  it("délègue au registry et renvoie le lien résolu (Djomy ou Moneroo, transparent à l'appelant)", async () => {
    const registry = {
      resolve: vi.fn().mockResolvedValue({
        provider: "djomy",
        providerRef: "djomy-ref",
        paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
        feeGatewayGnf: 1_000_000n,
        expiresAt: new Date("2026-09-07T00:00:00.000Z"),
      }),
    };
    const service = new PaymentLinksService(registry as any);

    const result = await service.createPaymentLink(
      "3b3963da-d099-43ea-996b-80000060b28a",
      "92b6a988-f570-4b4f-94bc-3acfd2a98758",
      100_000_000n,
    );

    expect(registry.resolve).toHaveBeenCalledWith({
      invoiceId: "3b3963da-d099-43ea-996b-80000060b28a",
      organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
      amountGnf: 100_000_000n,
    });
    expect(result.provider).toBe("djomy");
    expect(result.paymentLinkUrl).toBe("https://stub.djomy.africa/pay/djomy-ref");
  });
});
