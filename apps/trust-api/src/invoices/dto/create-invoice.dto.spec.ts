import { describe, expect, it } from "vitest";
import { createInvoiceSchema } from "./create-invoice.dto";

describe("createInvoiceSchema — taxRateBps n'est plus un champ client (C4)", () => {
  it("accepte une ligne sans taxRateBps — le taux est désormais dérivé du régime fiscal de l'organisation", () => {
    const result = createInvoiceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 2, unitPrice: "350000" }],
    });

    expect(result.success).toBe(true);
  });

  it("ignore silencieusement un taxRateBps fourni par le client — jamais une valeur de confiance externe", () => {
    const result = createInvoiceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 2, unitPrice: "350000", taxRateBps: 999 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines[0]).not.toHaveProperty("taxRateBps");
    }
  });
});
