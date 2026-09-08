import { describe, expect, it } from "vitest";
import type { PublicBuyerInvoice } from "@/lib/trust-api";
import {
  canValidateLiquidation,
  isSecondaryFinancingLocked,
  liquidationStage,
  netVerseALaPme,
  railOf,
  referenceDepense,
} from "./daf";

// Facture B2G de référence : émise, non visée, non financée. Chaque test ne
// surcharge que le champ qu'il éprouve — un objet complet par cas rendrait
// invisible ce qui est réellement sous test.
function facture(overrides: Partial<PublicBuyerInvoice> = {}): PublicBuyerInvoice {
  return {
    id: "3f1c2b8a-0000-4000-8000-000000000001",
    number: "FG-2026-0042",
    certificationId: "FG-A1B2C3",
    status: "issued",
    disputeStatus: "none",
    validatedByAdministration: false,
    totalTtc: "125000000",
    amountDue: "125000000",
    issuedAt: "2026-08-01T10:00:00.000Z",
    cadreFacturation: "marche_public",
    referenceMarche: null,
    numeroBonCommande: null,
    numeroEngagement: null,
    financedByPartnerId: null,
    financedAt: null,
    ...overrides,
  };
}

describe("railOf", () => {
  it("Rail B par défaut — aucune cession, règlement direct à échéance (ADR-088)", () => {
    expect(railOf(facture())).toBe("B");
  });

  it("Rail A dès qu'un partenaire financier porte la créance", () => {
    expect(railOf(facture({ financedByPartnerId: "partner-1" }))).toBe("A");
  });
});

describe("isSecondaryFinancingLocked — K5, anti-double-nantissement", () => {
  it("ne verrouille pas une créance jamais cédée", () => {
    expect(isSecondaryFinancingLocked(facture())).toBe(false);
  });

  // Le test qui protège l'invariant central de cet écran : tant qu'il est vert,
  // aucune facture déjà financée ne peut se voir proposer un second rachat.
  it("verrouille dès que financedByPartnerId est renseigné, quel que soit le reste", () => {
    expect(isSecondaryFinancingLocked(facture({ financedByPartnerId: "partner-1" }))).toBe(true);
  });

  it("verrouille même une facture déjà payée — le rachat resterait un double financement", () => {
    expect(
      isSecondaryFinancingLocked(facture({ financedByPartnerId: "partner-1", status: "paid" })),
    ).toBe(true);
  });
});

describe("canValidateLiquidation", () => {
  it("autorise le visa d'une facture émise non encore visée", () => {
    expect(canValidateLiquidation(facture())).toBe(true);
  });

  it("refuse un second visa — le service est idempotent, le geste serait sans effet", () => {
    expect(canValidateLiquidation(facture({ validatedByAdministration: true }))).toBe(false);
  });

  it("refuse une facture draft — jamais émise, aucune créance à reconnaître", () => {
    expect(canValidateLiquidation(facture({ status: "draft" }))).toBe(false);
  });

  it("refuse une facture annulée — plus aucune dette à liquider (PRD §4.2)", () => {
    expect(canValidateLiquidation(facture({ status: "voided" }))).toBe(false);
  });

  it("autorise le visa d'une facture partiellement payée — paiement et visa sont indépendants", () => {
    expect(canValidateLiquidation(facture({ status: "partially_paid" }))).toBe(true);
  });
});

describe("liquidationStage", () => {
  it("non_visee sur une facture émise sans visa", () => {
    expect(liquidationStage(facture())).toBe("non_visee");
  });

  it("visee après le visa du service fait", () => {
    expect(liquidationStage(facture({ validatedByAdministration: true }))).toBe("visee");
  });

  // La cession prime : c'est au partenaire que l'administration devra régler.
  it("cedee prime sur visee quand la créance a été financée", () => {
    expect(
      liquidationStage(facture({ validatedByAdministration: true, financedByPartnerId: "partner-1" })),
    ).toBe("cedee");
  });

  it("sans_objet sur draft comme sur voided", () => {
    expect(liquidationStage(facture({ status: "draft" }))).toBe("sans_objet");
    expect(liquidationStage(facture({ status: "voided" }))).toBe("sans_objet");
  });
});

describe("netVerseALaPme — Rail A, ADR-089", () => {
  // La règle que ce test verrouille : les frais de décaissement sont portés par
  // l'établissement financier. Si quelqu'un introduit un jour une déduction, ce
  // test tombe — c'est tout son objet.
  it("rend le total certifié intact — les frais de décaissement ne sont jamais déduits", () => {
    expect(netVerseALaPme(facture({ totalTtc: "125000000" }))).toBe("125000000");
  });

  it("reste intact sur une créance cédée", () => {
    expect(netVerseALaPme(facture({ totalTtc: "98765400", financedByPartnerId: "partner-1" }))).toBe(
      "98765400",
    );
  });
});

describe("referenceDepense", () => {
  it("préfère l'engagement — la référence la plus spécifique du circuit de la dépense", () => {
    expect(
      referenceDepense(facture({ numeroEngagement: "ENG-77", numeroBonCommande: "BC-12", referenceMarche: "M-1" })),
    ).toEqual({ label: "Engagement", value: "ENG-77" });
  });

  it("retombe sur le bon de commande, puis le marché", () => {
    expect(referenceDepense(facture({ numeroBonCommande: "BC-12", referenceMarche: "M-1" }))).toEqual({
      label: "Bon de commande",
      value: "BC-12",
    });
    expect(referenceDepense(facture({ referenceMarche: "M-1" }))).toEqual({ label: "Marché", value: "M-1" });
  });

  it("retombe sur le numéro de facture, puis l'identifiant technique — jamais un libellé inventé", () => {
    expect(referenceDepense(facture())).toEqual({ label: "Facture", value: "FG-2026-0042" });
    expect(referenceDepense(facture({ number: null }))).toEqual({
      label: "Référence interne",
      value: "3f1c2b8a-0000-4000-8000-000000000001",
    });
  });
});
