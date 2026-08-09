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
