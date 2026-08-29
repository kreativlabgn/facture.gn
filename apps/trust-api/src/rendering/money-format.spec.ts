import { describe, expect, it } from "vitest";
import { formatGnf } from "./money-format";

// Montants stockes en centimes GNF (100 centimes = 1 GNF, DAT / ADR-014).
// Ce helper est la restitution HUMAINE — distinct de fec-formatting.ts
// (formatFecAmount, format machine "1250000.00" pour l'export legal FEC).
// Separateur de milliers = espace insecable U+00A0 (evite un retour a la ligne
// au milieu d'un montant dans le PDF).
const NBSP = " ";

describe("formatGnf — restitution humaine d'un montant en centimes GNF", () => {
  it("affiche zero sans decimale", () => {
    expect(formatGnf(0n)).toBe("0 GNF");
  });

  it("affiche 1 GNF pour 100 centimes", () => {
    expect(formatGnf(100n)).toBe("1 GNF");
  });

  it("separe les milliers par un espace insecable", () => {
    expect(formatGnf(125_000_00n)).toBe(`125${NBSP}000 GNF`);
    expect(formatGnf(1_250_000_00n)).toBe(`1${NBSP}250${NBSP}000 GNF`);
    expect(formatGnf(123_456_789_00n)).toBe(`123${NBSP}456${NBSP}789 GNF`);
  });

  it("affiche deux decimales separees par une virgule quand le centime n'est pas rond", () => {
    // Cas reel : computeTaxBreakdown fait une division entiere — totalHt/totalTva
    // d'une facture peuvent avoir une fraction de GNF.
    expect(formatGnf(1_250_000_50n)).toBe(`1${NBSP}250${NBSP}000,50 GNF`);
    expect(formatGnf(105n)).toBe("1,05 GNF");
    expect(formatGnf(1n)).toBe("0,01 GNF");
  });

  it("prefixe un montant negatif sans planter (garde — jamais attendu en pratique)", () => {
    expect(formatGnf(-500_00n)).toBe("-500 GNF");
    expect(formatGnf(-105n)).toBe("-1,05 GNF");
  });
});
