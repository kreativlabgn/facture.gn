import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentLinksService } from "./payment-links.service";

const INVOICE_ID = "3b3963da-d099-43ea-996b-80000060b28a";

function createFakePrisma(attempt: any = null) {
  return {
    paymentProviderAttempt: {
      findFirst: vi.fn().mockResolvedValue(attempt),
    },
  };
}

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
    const service = new PaymentLinksService(registry as any, createFakePrisma() as any);

    const result = await service.createPaymentLink(
      INVOICE_ID,
      "92b6a988-f570-4b4f-94bc-3acfd2a98758",
      100_000_000n,
    );

    expect(registry.resolve).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      organizationId: "92b6a988-f570-4b4f-94bc-3acfd2a98758",
      amountGnf: 100_000_000n,
    });
    expect(result.provider).toBe("djomy");
    expect(result.paymentLinkUrl).toBe("https://stub.djomy.africa/pay/djomy-ref");
  });
});

describe("PaymentLinksService — checkout public (C19)", () => {
  it("retourne la dernière tentative réussie, uniquement les champs destinés au payeur", async () => {
    const prisma = createFakePrisma({
      provider: "djomy",
      paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
      amountGnf: 100_000_000n,
      feeGateway: 1_000_000n,
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
    });
    const service = new PaymentLinksService({} as any, prisma as any);

    const result = await service.getPublicCheckout(INVOICE_ID);

    expect(prisma.paymentProviderAttempt.findFirst).toHaveBeenCalledWith({
      where: { invoiceId: INVOICE_ID, status: "success" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual({
      provider: "djomy",
      paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
      amountGnf: 100_000_000n,
      feeGatewayGnf: 1_000_000n,
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
    });
  });

  it("lève NotFoundException si aucune tentative réussie n'existe pour cette facture", async () => {
    const service = new PaymentLinksService({} as any, createFakePrisma(null) as any);

    await expect(service.getPublicCheckout(INVOICE_ID)).rejects.toThrow(NotFoundException);
  });
});
