import { describe, expect, it } from "vitest";
import { untdidTypeCode } from "./untdid";

// UNTDID 1001 (EN 16931 BT-3) — code de type de document. Préparation de
// l'export UBL 2.1 (ADR-053) : à ce jour le helper n'a qu'un usage d'affichage
// (PDF Lot A), le mapping complet vit ici pour être réutilisé par l'export.
describe("untdidTypeCode", () => {
  it("facture -> 380", () => {
    expect(untdidTypeCode("invoice")).toBe("380");
  });

  it("proforma -> 325", () => {
    expect(untdidTypeCode("proforma")).toBe("325");
  });

  it("devis -> null (aucun code UNTDID 1001 dédié au devis)", () => {
    expect(untdidTypeCode("quote")).toBeNull();
  });
});
