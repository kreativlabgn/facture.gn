import { describe, expect, it, vi } from "vitest";
import { InvoicesController } from "./invoices.controller";

describe("InvoicesController — POST /invoices/:id/convert-to-invoice (C15)", () => {
  it("délègue au service avec l'id du proforma du paramètre d'URL", async () => {
    const service = { convertToInvoice: vi.fn().mockResolvedValue({ id: "inv-2", documentType: "invoice" }) };
    const controller = new InvoicesController(service as any, {} as any);

    const result = await controller.convertToInvoice("inv-1");

    expect(service.convertToInvoice).toHaveBeenCalledWith("inv-1");
    expect(result).toEqual({ id: "inv-2", documentType: "invoice" });
  });
});

describe("InvoicesController — POST /invoices/:id/forfeit-deposit (C5)", () => {
  it("délègue au service avec l'id du proforma, le reason du body, et l'utilisateur courant (traçabilité audit)", async () => {
    const service = { forfeitDeposit: vi.fn().mockResolvedValue({ id: "event-1", type: "no_show_forfeited" }) };
    const controller = new InvoicesController(service as any, {} as any);

    const result = await controller.forfeitDeposit(
      "proforma-1",
      { reason: "no_show_forfeited" },
      { id: "user-djenabou" },
    );

    expect(service.forfeitDeposit).toHaveBeenCalledWith("proforma-1", "no_show_forfeited", "user-djenabou");
    expect(result).toEqual({ id: "event-1", type: "no_show_forfeited" });
  });
});

describe("InvoicesController — POST /invoices/:id/send-reminder (I2)", () => {
  it("délègue au service avec l'id de la facture et l'utilisateur courant", async () => {
    const service = { sendReminder: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued" }) };
    const controller = new InvoicesController(service as any, {} as any);

    const result = await controller.sendReminder("inv-1", { id: "user-djenabou" });

    expect(service.sendReminder).toHaveBeenCalledWith("inv-1", "user-djenabou");
    expect(result).toEqual({ id: "inv-1", status: "issued" });
  });
});

describe("InvoicesController — GET /invoices (filtre canal d'émission, Lot D)", () => {
  it("transmet emissionChannel de la query au service", async () => {
    const service = { findAllByOrganization: vi.fn().mockResolvedValue([]) };
    const controller = new InvoicesController(service as any, {} as any);

    await controller.findAll({ organizationId: "org-1", emissionChannel: "ussd" } as any);

    expect(service.findAllByOrganization).toHaveBeenCalledWith("org-1", {
      take: undefined,
      skip: undefined,
      emissionChannel: "ussd",
    });
  });

  it("sans filtre, appelle le service sans emissionChannel", async () => {
    const service = { findAllByOrganization: vi.fn().mockResolvedValue([]) };
    const controller = new InvoicesController(service as any, {} as any);

    await controller.findAll({ organizationId: "org-1" } as any);

    expect(service.findAllByOrganization).toHaveBeenCalledWith("org-1", {
      take: undefined,
      skip: undefined,
      emissionChannel: undefined,
    });
  });
});

describe("InvoicesController — GET /invoices/:id/pdf (Lot A)", () => {
  it("délègue au renderer et renvoie un StreamableFile application/pdf en pièce jointe", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(2000)]);
    const rendering = {
      renderInvoicePdf: vi.fn().mockResolvedValue({ pdf, filename: "facture-FG-2026-000042.pdf" }),
    };
    const controller = new InvoicesController({} as any, rendering as any);

    const result = await controller.downloadPdf("inv-1");

    expect(rendering.renderInvoicePdf).toHaveBeenCalledWith("inv-1");
    const headers = result.getHeaders();
    expect(headers.type).toBe("application/pdf");
    expect(headers.disposition).toContain("attachment");
    expect(headers.disposition).toContain("facture-FG-2026-000042.pdf");
  });
});
