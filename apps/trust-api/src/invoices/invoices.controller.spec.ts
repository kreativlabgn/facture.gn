import { describe, expect, it, vi } from "vitest";
import { InvoicesController } from "./invoices.controller";

describe("InvoicesController — POST /invoices/:id/convert-to-invoice (C15)", () => {
  it("délègue au service avec l'id du proforma du paramètre d'URL", async () => {
    const service = { convertToInvoice: vi.fn().mockResolvedValue({ id: "inv-2", documentType: "invoice" }) };
    const controller = new InvoicesController(service as any);

    const result = await controller.convertToInvoice("inv-1");

    expect(service.convertToInvoice).toHaveBeenCalledWith("inv-1");
    expect(result).toEqual({ id: "inv-2", documentType: "invoice" });
  });
});

describe("InvoicesController — POST /invoices/:id/forfeit-deposit (C5)", () => {
  it("délègue au service avec l'id du proforma et le reason du body", async () => {
    const service = { forfeitDeposit: vi.fn().mockResolvedValue({ id: "event-1", type: "no_show_forfeited" }) };
    const controller = new InvoicesController(service as any);

    const result = await controller.forfeitDeposit("proforma-1", { reason: "no_show_forfeited" });

    expect(service.forfeitDeposit).toHaveBeenCalledWith("proforma-1", "no_show_forfeited");
    expect(result).toEqual({ id: "event-1", type: "no_show_forfeited" });
  });
});
