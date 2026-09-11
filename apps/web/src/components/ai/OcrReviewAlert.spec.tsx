import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OcrReviewAlert, formatCentimes, libelleChemin, type OcrFinding } from "./OcrReviewAlert";

const ECART_TVA: OcrFinding = {
  code: "TVA_REGIME",
  chemin: "totals.totalVAT",
  attendu: "23400000",
  constate: "23400001",
};

const ECART_LIGNE: OcrFinding = {
  code: "LIGNE_TOTAL",
  chemin: "lines.2.lineTotal",
  attendu: "100000000",
  constate: "100000100",
};

describe("OcrReviewAlert (ADR-122)", () => {
  it("annonce la relecture en toutes lettres, avec une icône SVG inline, sous role=alert", () => {
    const html = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Relecture requise");
    expect(html).toContain("aucune facture n");
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });

  // Le contraste en plein soleil : ambre foncé sur SURFACE BLANCHE, corps en
  // Navy — jamais l'Or de marque, jamais du texte clair.
  it("pose l'ambre foncé sur fond blanc et n'emploie jamais l'Or de Guinée", () => {
    const html = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} />);

    expect(html).toContain("border-amber-text");
    expect(html).toContain("bg-white");
    expect(html).toContain("text-amber-text");
    expect(html).not.toMatch(/\b(?:bg|text|border)-or\b/);
    expect(html).not.toContain("text-white");
  });

  // L'écart qui a déclenché l'alerte est d'UN centime : les deux montants
  // doivent être distinguables à l'écran, donc affichés avec leurs centimes.
  it("affiche le montant lu et le montant attendu AVEC leurs centimes", () => {
    const html = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} />);

    expect(html).toContain("234 000,01 GNF");
    expect(html).toContain("234 000,00 GNF");
    expect(html).toContain("Lu sur le papier");
    expect(html).toContain("Attendu");
  });

  it("nomme chaque écart par son champ et son libellé, et accorde le pluriel", () => {
    const html = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA, ECART_LIGNE]} />);

    expect(html).toContain("2 écarts");
    expect(html).toContain("TVA");
    expect(html).toContain("Ligne 3");
    expect(html).toContain("ne correspond pas à votre régime fiscal");
    expect(html).toContain("quantité × prix unitaire");
  });

  it("rend l'action de saisie manuelle quand elle est fournie", () => {
    const html = renderToStaticMarkup(
      <OcrReviewAlert findings={[ECART_TVA]} action={<button type="button">Saisir à la main</button>} />,
    );

    expect(html).toContain("Saisir à la main");
  });
});

describe("formatCentimes", () => {
  it("sépare textuellement les centimes, sans flottant", () => {
    expect(formatCentimes("23400001")).toBe("234 000,01 GNF");
    expect(formatCentimes("5")).toBe("0,05 GNF");
    expect(formatCentimes("0")).toBe("0,00 GNF");
    // Au-delà de Number.MAX_SAFE_INTEGER, chiffre pour chiffre.
    expect(formatCentimes("12345678901234567")).toBe("123 456 789 012 345,67 GNF");
  });
});

describe("libelleChemin", () => {
  it("traduit les chemins Zod en libellés lisibles, index de ligne humain (1-based)", () => {
    expect(libelleChemin("lines.0.lineTotal")).toBe("Ligne 1");
    expect(libelleChemin("lines.2.lineTotal")).toBe("Ligne 3");
    expect(libelleChemin("totals.totalVAT")).toBe("TVA");
    expect(libelleChemin("totals.totalTTC")).toBe("Total TTC");
    expect(libelleChemin("inconnu")).toBe("inconnu");
  });
});
