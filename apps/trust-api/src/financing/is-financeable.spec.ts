import { describe, expect, it } from "vitest";
import { financeableInvoiceWhere, isFinanceable } from "./is-financeable";

function baseInvoice(
  overrides: Partial<{
    validatedByAdministration: boolean;
    financedByPartnerId: string | null;
    status: string;
    publicBuyerAccountVerified: boolean;
  }> = {},
) {
  return {
    validatedByAdministration: true,
    financedByPartnerId: null,
    status: "issued",
    publicBuyerAccountVerified: true,
    ...overrides,
  } as any;
}

describe("isFinanceable (K4, ADR-031/080/088)", () => {
  it("finançable : validée par l'administration, jamais financée, pas annulée, compte acheteur public vérifié", () => {
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

  it("non finançable : PublicBuyerAccount pas encore vérifié (Security Audit 2026-08-23, finding #1)", () => {
    expect(isFinanceable(baseInvoice({ publicBuyerAccountVerified: false }))).toBe(false);
  });
});

describe("financeableInvoiceWhere (K4/K5) — reproduit isFinanceable() en clause Prisma", () => {
  it("reproduit les 4 conditions de isFinanceable()", () => {
    expect(financeableInvoiceWhere("inv-1")).toEqual({
      id: "inv-1",
      financedByPartnerId: null,
      validatedByAdministration: true,
      status: { not: "voided" },
      customer: { publicBuyerAccount: { verificationStatus: "verified" } },
    });
  });
});
