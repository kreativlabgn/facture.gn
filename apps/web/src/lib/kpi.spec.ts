import { describe, expect, it } from "vitest";
import { deriveInvoiceWindowKpis, formatVerifiedPaymentRatio } from "./kpi";
import type { InvoiceListItem } from "./trust-api";

function invoice(overrides: Partial<InvoiceListItem>): InvoiceListItem {
  return {
    id: "i1",
    number: "FG-1",
    status: "issued",
    totalTtc: "0",
    certificationId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    // Les quatre colonnes du parcours légal : une facture ordinaire n'en porte
    // aucune. Les KPI de fenêtre ne les lisent pas — elles sont ici pour que le
    // gabarit reste une InvoiceListItem complète.
    disputeStatus: "none",
    validatedByAdministration: false,
    etaxStatus: null,
    etaxReceiptNumber: null,
    ...overrides,
  };
}

describe("kpi — agrégats de fenêtre", () => {
  it("somme les montants en BigInt, sans passer par un number", () => {
    // Au-delà de Number.MAX_SAFE_INTEGER (9_007_199_254_740_991) une somme en
    // number perdrait des centimes en silence. Deux montants qui le dépassent
    // une fois additionnés : le total doit rester exact au centime.
    const kpis = deriveInvoiceWindowKpis([
      invoice({ id: "a", totalTtc: "9007199254740991" }),
      invoice({ id: "b", totalTtc: "9007199254740991" }),
    ]);
    expect(kpis.totalTtcCentimes).toBe("18014398509481982");
  });

  // « En attente » = émise mais pas soldée. Un brouillon n'a rien été demandé
  // à personne ; une annulée ou une expirée ne sera jamais encaissée.
  it("ne compte comme en attente que les factures émises non soldées", () => {
    const kpis = deriveInvoiceWindowKpis([
      invoice({ id: "a", status: "issued" }),
      invoice({ id: "b", status: "partially_paid" }),
      invoice({ id: "c", status: "paid" }),
      invoice({ id: "d", status: "draft" }),
      invoice({ id: "e", status: "voided" }),
      invoice({ id: "f", status: "expired" }),
    ]);
    expect(kpis.awaitingPaymentCount).toBe(2);
    expect(kpis.windowSize).toBe(6);
  });

  it("laisse les brouillons et les annulées hors du total en francs", () => {
    // La régression qui a rendu ce test nécessaire : une facture annulée
    // sortait bien du compteur « en attente », mais restait dans la somme.
    // L'écran affichait donc un encours que l'organisation ne pouvait
    // réclamer à personne.
    const kpis = deriveInvoiceWindowKpis([
      invoice({ id: "a", status: "issued", totalTtc: "100000" }),
      invoice({ id: "b", status: "paid", totalTtc: "200000" }),
      invoice({ id: "c", status: "voided", totalTtc: "85000000" }),
      invoice({ id: "d", status: "draft", totalTtc: "500000" }),
    ]);
    expect(kpis.totalTtcCentimes).toBe("300000");
    // La fenêtre, elle, compte tout ce qui a été lu.
    expect(kpis.windowSize).toBe(4);
  });

  it("reste défini sur une fenêtre vide", () => {
    expect(deriveInvoiceWindowKpis([])).toEqual({
      windowSize: 0,
      totalTtcCentimes: "0",
      awaitingPaymentCount: 0,
    });
  });
});

describe("kpi — ratio de paiements vérifiés", () => {
  // ratio null = aucun paiement enregistré. « Pas encore de donnée » n'est pas
  // « 0 % » : afficher 0 % accuserait l'organisation d'un mauvais chiffre
  // qu'elle n'a pas.
  it("distingue l'absence de donnée d'un ratio nul", () => {
    expect(formatVerifiedPaymentRatio(null)).toBe("—");
    expect(formatVerifiedPaymentRatio(0)).toBe("0 %");
    expect(formatVerifiedPaymentRatio(0.5)).toBe("50 %");
    expect(formatVerifiedPaymentRatio(1)).toBe("100 %");
  });
});
