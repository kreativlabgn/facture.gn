import { describe, expect, it } from "vitest";
import { financeableInvoiceWhere, isFinanceable } from "./is-financeable";

function baseInvoice(
  overrides: Partial<{
    validatedByAdministration: boolean;
    financedByPartnerId: string | null;
    status: string;
    publicBuyerAccountVerified: boolean;
    publicEntityConfirmed: boolean;
  }> = {},
) {
  return {
    validatedByAdministration: true,
    financedByPartnerId: null,
    status: "issued",
    publicBuyerAccountVerified: true,
    publicEntityConfirmed: true,
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

  it("non finançable : lien customer<->public_buyer_account jamais confirmé par le compte cible (Security Audit 2026-08-23, revue post-fix #1)", () => {
    expect(isFinanceable(baseInvoice({ publicEntityConfirmed: false }))).toBe(false);
  });

  it("non finançable : compte cible vérifié mais CE lien précis n'a jamais été confirmé — repointage post-validation vers un autre compte déjà verified (Security Audit 2026-08-23, revue post-fix #1, scénario d'attaque complet)", () => {
    // Un compte pending auto-créé a produit la validation (validatedByAdministration
    // resterait true si flagPublicEntity() ne le réinitialisait pas), puis le
    // client a été repointé vers un vrai compte "verified" sans son consentement.
    // publicBuyerAccountVerified=true (le compte cible EST verified) mais
    // publicEntityConfirmed=false (jamais confirmé par CE compte) — sans la 5e
    // condition, ce cas serait finançable à tort.
    expect(
      isFinanceable(baseInvoice({ publicBuyerAccountVerified: true, publicEntityConfirmed: false })),
    ).toBe(false);
  });
});

describe("financeableInvoiceWhere (K4/K5) — reproduit isFinanceable() en clause Prisma", () => {
  it("reproduit les 5 conditions de isFinanceable()", () => {
    expect(financeableInvoiceWhere("inv-1")).toEqual({
      id: "inv-1",
      financedByPartnerId: null,
      validatedByAdministration: true,
      status: { not: "voided" },
      customer: {
        isPublicEntityConfirmed: true,
        publicBuyerAccount: { verificationStatus: "verified" },
      },
    });
  });
});
