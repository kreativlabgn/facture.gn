import { describe, expect, it } from "vitest";
import {
  getPartnerTierMaxOrganizations,
  getPartnerTierPrice,
  tierAccepteOrganisations,
} from "./partner-tier-grid";

describe("getPartnerTierPrice (H3, ADR-071, Grille-Offres §5.1)", () => {
  it("partner_free = 0 GNF, fixe", () => {
    expect(getPartnerTierPrice("partner_free")).toEqual({ kind: "fixed", amountCentimes: 0n });
  });

  it("partner_starter = 500 000 GNF, fixe", () => {
    expect(getPartnerTierPrice("partner_starter")).toEqual({ kind: "fixed", amountCentimes: 50_000_000n });
  });

  it("partner_pro = 1 500 000 GNF, fixe", () => {
    expect(getPartnerTierPrice("partner_pro")).toEqual({ kind: "fixed", amountCentimes: 150_000_000n });
  });

  it("partner_institutional = sur devis, jamais un montant inventé", () => {
    expect(getPartnerTierPrice("partner_institutional")).toEqual({ kind: "quote_required" });
  });
});

// La grille ne portait que des PRIX. Free ≤ 5 organisations, Starter ≤ 50,
// Pro illimité : ce volet-là n'existait nulle part, et rien ne l'appliquait —
// un partenaire Free pouvait suivre deux cents PME sans jamais payer.
describe("plafond d'organisations par palier (ADR-071, Grille-Offres)", () => {
  it("porte les plafonds annoncés", () => {
    expect(getPartnerTierMaxOrganizations("partner_free")).toBe(5);
    expect(getPartnerTierMaxOrganizations("partner_starter")).toBe(50);
  });

  // `null` est une valeur SIGNIFIANTE — illimité par contrat, pas une donnée
  // manquante ni un très grand nombre déguisé.
  it("Pro et Institutionnel sont illimités", () => {
    expect(getPartnerTierMaxOrganizations("partner_pro")).toBeNull();
    expect(getPartnerTierMaxOrganizations("partner_institutional")).toBeNull();
  });

  it("accepte jusqu'au plafond inclus, refuse au-delà", () => {
    expect(tierAccepteOrganisations("partner_free", 5)).toBe(true);
    expect(tierAccepteOrganisations("partner_free", 6)).toBe(false);
    expect(tierAccepteOrganisations("partner_starter", 50)).toBe(true);
    expect(tierAccepteOrganisations("partner_starter", 51)).toBe(false);
  });

  it("un palier illimité accepte n'importe quel volume", () => {
    expect(tierAccepteOrganisations("partner_pro", 10_000)).toBe(true);
    expect(tierAccepteOrganisations("partner_institutional", 10_000)).toBe(true);
  });
});
