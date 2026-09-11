import { describe, expect, it } from "vitest";
import { STATUTS_FINANCABLES, financeableInvoiceWhere, isFinanceable } from "./is-financeable";

function baseInvoice(
  overrides: Partial<{
    validatedByAdministration: boolean;
    financedByPartnerId: string | null;
    status: string;
    disputeStatus: string;
    publicBuyerAccountVerified: boolean;
    publicEntityConfirmed: boolean;
  }> = {},
) {
  return {
    validatedByAdministration: true,
    financedByPartnerId: null,
    status: "issued",
    disputeStatus: "none",
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

  // ── Durcissement 2026-09-10 — anti-double-encaissement du Capital Layer ──

  it("non finançable : facture déjà encaissée (paid) — une créance réglée ne se rachète pas", () => {
    expect(isFinanceable(baseInvoice({ status: "paid" }))).toBe(false);
  });

  it("non finançable : facture sous litige actif, même émise et visée par l'administration", () => {
    // disputeStatus est ORTHOGONAL à status : la facture est bien `issued`, et
    // un prédicat qui ne regarderait que `status` la financerait.
    expect(isFinanceable(baseInvoice({ status: "issued", disputeStatus: "disputed" }))).toBe(false);
  });

  it("finançable de nouveau une fois le litige résolu (resolved ne bloque pas)", () => {
    expect(isFinanceable(baseInvoice({ disputeStatus: "resolved" }))).toBe(true);
  });

  it("non finançable : partiellement réglée — le décaissement est tracé à la valeur faciale", () => {
    expect(isFinanceable(baseInvoice({ status: "partially_paid" }))).toBe(false);
  });

  it("non finançable : tout statut hors de la liste en positif (brouillon, convertie, expirée)", () => {
    // Liste en POSITIF : un statut ajouté demain à l'enum n'est pas finançable
    // par défaut. C'est la propriété que ce test verrouille, pas la liste des
    // trois valeurs citées.
    for (const status of ["draft", "converted", "expired"]) {
      expect(isFinanceable(baseInvoice({ status }))).toBe(false);
    }
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
  it("reproduit les 7 conditions de isFinanceable()", () => {
    expect(financeableInvoiceWhere("inv-1")).toEqual({
      id: "inv-1",
      financedByPartnerId: null,
      validatedByAdministration: true,
      status: { in: ["issued"] },
      disputeStatus: { not: "disputed" },
      customer: {
        isPublicEntityConfirmed: true,
        publicBuyerAccount: { verificationStatus: "verified" },
      },
    });
  });

  it("refuse par la clause `where` exactement ce que le prédicat refuse (paid, disputed)", () => {
    // Les deux formes vivent côte à côte pour une raison : le prédicat sert
    // l'affichage, la clause sert le commit. Ce test relit la seconde à travers
    // la première — si l'une gagne une condition que l'autre n'a pas, il tombe.
    const where = financeableInvoiceWhere("inv-1");
    expect(where.status.in).not.toContain("paid");
    expect(where.status.in).toEqual([...STATUTS_FINANCABLES]);
    expect(where.disputeStatus).toEqual({ not: "disputed" });
  });
});
