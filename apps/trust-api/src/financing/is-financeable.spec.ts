import { describe, expect, it } from "vitest";
import { isFinanceable } from "./is-financeable";

function baseInvoice(overrides: Partial<{ validatedByAdministration: boolean; financedByPartnerId: string | null; status: string }> = {}) {
  return {
    validatedByAdministration: true,
    financedByPartnerId: null,
    status: "issued",
    ...overrides,
  } as any;
}

describe("isFinanceable (K4, ADR-031/080/088)", () => {
  it("finançable : validée par l'administration, jamais financée, pas annulée", () => {
    expect(isFinanceable(baseInvoice())).toBe(true);
  });

  it("non finançable : pas encore validée par l'administration", () => {
    expect(isFinanceable(baseInvoice({ validatedByAdministration: false }))).toBe(false);
  });

  it("non finançable : déjà financée (K5, anti-double financement)", () => {
    expect(isFinanceable(baseInvoice({ financedByPartnerId: "partner-1" }))).toBe(false);
  });

  it("non finançable : facture annulée (voided)", () => {
    expect(isFinanceable(baseInvoice({ status: "voided" }))).toBe(false);
  });
});
