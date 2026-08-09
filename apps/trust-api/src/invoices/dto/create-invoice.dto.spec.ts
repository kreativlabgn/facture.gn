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

describe("createInvoiceSchema — remise globale (E2)", () => {
  it("applique 0 par défaut si discountPct est absent — aucune facture existante cassée", () => {
    const result = createInvoiceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 2, unitPrice: "350000" }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountPct).toBe(0);
    }
  });

  it("rejette un discountPct hors de la plage 0-100", () => {
    const tropBas = createInvoiceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 2, unitPrice: "350000" }],
      discountPct: -1,
    });
    const tropHaut = createInvoiceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 2, unitPrice: "350000" }],
      discountPct: 101,
    });

    expect(tropBas.success).toBe(false);
    expect(tropHaut.success).toBe(false);
  });
});

describe("createInvoiceSchema — montant de référence en devise étrangère (I3, ADR-055)", () => {
  const base = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    documentType: "invoice" as const,
    lines: [{ description: "Prestation conseil diaspora", quantity: 1, unitPrice: "1180000" }],
  };

  it("accepte une facture sans aucun des 4 champs de référence devise — non-régression", () => {
    const result = createInvoiceSchema.safeParse(base);

    expect(result.success).toBe(true);
  });

  it("accepte les 4 champs fournis ensemble", () => {
    const result = createInvoiceSchema.safeParse({
      ...base,
      referenceCurrency: "USD",
      referenceAmount: "125",
      fxRate: "9440.50",
      fxRateDate: "2026-08-09",
    });

    expect(result.success).toBe(true);
  });

  it("rejette si un seul des 4 champs est fourni — ils forment un seul instantané de change cohérent", () => {
    const result = createInvoiceSchema.safeParse({
      ...base,
      referenceCurrency: "USD",
    });

    expect(result.success).toBe(false);
  });

  it("rejette un referenceCurrency mal formé — jamais une devise arbitraire non normalisée (ISO 4217)", () => {
    const minuscule = createInvoiceSchema.safeParse({
      ...base,
      referenceCurrency: "usd",
      referenceAmount: "125",
      fxRate: "9440.50",
      fxRateDate: "2026-08-09",
    });
    const troisLettresManquantes = createInvoiceSchema.safeParse({
      ...base,
      referenceCurrency: "US",
      referenceAmount: "125",
      fxRate: "9440.50",
      fxRateDate: "2026-08-09",
    });

    expect(minuscule.success).toBe(false);
    expect(troisLettresManquantes.success).toBe(false);
  });
});
