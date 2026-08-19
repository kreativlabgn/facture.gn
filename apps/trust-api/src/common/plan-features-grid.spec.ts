import { CommercialTier } from "@facture-gn/db";
import { describe, expect, it } from "vitest";
import {
  ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER,
  isAdvancedCustomerManagementAllowed,
  isRoleAllowedForTier,
  maxBranchesForTier,
  maxMembersForTier,
  TIER_ORDER,
} from "./plan-features-grid";

// dev-domain-model-reviewer (H1) — protège contre l'ajout d'un palier au
// schéma (ex. Starter Plus, ADR-106) sans mise à jour de la grille : sans ce
// garde-fou, tierIndex() renverrait -1 pour le nouveau palier et toutes les
// comparaisons deviendraient silencieusement fausses.
describe("TIER_ORDER (H1) — cohérence avec l'enum Prisma CommercialTier", () => {
  it("contient exactement les paliers déclarés dans le schéma", () => {
    expect(new Set(TIER_ORDER)).toEqual(new Set(Object.values(CommercialTier)));
  });
});

describe("isRoleAllowedForTier (H1, Grille §2)", () => {
  it("un rôle de base (owner) est toujours autorisé, y compris en Freemium", () => {
    expect(isRoleAllowedForTier("owner", "freemium")).toBe(true);
  });

  it("tax_controller_readonly est ouvert dès Freemium (conformité DGI, §2.1)", () => {
    expect(isRoleAllowedForTier("tax_controller_readonly", "freemium")).toBe(true);
  });

  it("inventory_manager est refusé en Freemium (nécessite Starter+)", () => {
    expect(isRoleAllowedForTier("inventory_manager", "freemium")).toBe(false);
  });

  it("inventory_manager est autorisé dès Starter", () => {
    expect(isRoleAllowedForTier("inventory_manager", "starter")).toBe(true);
  });

  it("approver est refusé en Starter (nécessite Pro+)", () => {
    expect(isRoleAllowedForTier("approver", "starter")).toBe(false);
  });

  it("approver, auditor et developer_api sont autorisés dès Pro", () => {
    expect(isRoleAllowedForTier("approver", "pro")).toBe(true);
    expect(isRoleAllowedForTier("auditor", "pro")).toBe(true);
    expect(isRoleAllowedForTier("developer_api", "pro")).toBe(true);
  });
});

describe("maxBranchesForTier / maxMembersForTier (H1, Grille §2)", () => {
  it("Freemium plafonne à 1 succursale et 1 collaborateur", () => {
    expect(maxBranchesForTier("freemium")).toBe(1);
    expect(maxMembersForTier("freemium")).toBe(1);
  });

  it("Starter plafonne à 2 succursales et 4 collaborateurs", () => {
    expect(maxBranchesForTier("starter")).toBe(2);
    expect(maxMembersForTier("starter")).toBe(4);
  });

  it("Pro et au-delà : succursales illimitées (null)", () => {
    expect(maxBranchesForTier("pro")).toBeNull();
    expect(maxBranchesForTier("enterprise")).toBeNull();
    expect(maxBranchesForTier("custom")).toBeNull();
  });

  it("Enterprise et Custom : collaborateurs illimités (null), Pro reste plafonné à 10", () => {
    expect(maxMembersForTier("pro")).toBe(10);
    expect(maxMembersForTier("enterprise")).toBeNull();
    expect(maxMembersForTier("custom")).toBeNull();
  });
});

describe("isAdvancedCustomerManagementAllowed (H1, Grille §2 — dépend de approver, ADR-083)", () => {
  it("refusé en Freemium et Starter", () => {
    expect(isAdvancedCustomerManagementAllowed("freemium")).toBe(false);
    expect(isAdvancedCustomerManagementAllowed("starter")).toBe(false);
  });

  it("autorisé dès Pro", () => {
    expect(isAdvancedCustomerManagementAllowed("pro")).toBe(true);
  });

  it("ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER vaut pro", () => {
    expect(ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER).toBe("pro");
  });
});
