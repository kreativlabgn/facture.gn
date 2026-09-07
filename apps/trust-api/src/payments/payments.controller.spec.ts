import { describe, expect, it, vi } from "vitest";
import { PaymentsController } from "./payments.controller";

describe("PaymentsController — GET /invoices/:id/payments/:paymentId/receipt (Lot A)", () => {
  it("délègue au renderer avec l'id facture ET l'id paiement (garde IDOR côté service) et renvoie un PDF en pièce jointe", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(2000)]);
    const rendering = {
      renderReceiptPdf: vi.fn().mockResolvedValue({ pdf, filename: "recu-FG-2026-000042-pay-1.pdf" }),
    };
    const controller = new PaymentsController({} as any, rendering as any);

    const result = await controller.downloadReceipt("inv-1", "pay-1", "org-1");

    expect(rendering.renderReceiptPdf).toHaveBeenCalledWith("inv-1", "pay-1", "org-1");
    const headers = result.getHeaders();
    expect(headers.type).toBe("application/pdf");
    expect(headers.disposition).toContain("attachment");
    expect(headers.disposition).toContain("recu-FG-2026-000042-pay-1.pdf");
  });
});
