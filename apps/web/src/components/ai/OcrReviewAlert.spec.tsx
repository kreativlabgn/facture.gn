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

// Plan 2026-09-16 (OCR multicanal vocal/WhatsApp) — la source ne change RIEN
// pour la photo (comportement historique), et porte un badge + une citation
// pour les trois nouveaux canaux d'ingestion.
describe("OcrReviewAlert — source d'ingestion (plan OCR multicanal)", () => {
  it("ne change AUCUN nœud DOM quand `source` est absent", () => {
    const sansProps = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} />);
    const avecSourceUndefined = renderToStaticMarkup(
      <OcrReviewAlert findings={[ECART_TVA]} source={undefined} textBrut={undefined} />,
    );

    expect(avecSourceUndefined).toBe(sansProps);
  });

  it("ne change AUCUN nœud DOM quand `source` vaut IMAGE_SCAN, même avec un textBrut fourni", () => {
    const sansProps = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} />);
    const avecImageScan = renderToStaticMarkup(
      <OcrReviewAlert findings={[ECART_TVA]} source="IMAGE_SCAN" textBrut="un texte qui ne doit jamais apparaître" />,
    );

    expect(avecImageScan).toBe(sansProps);
  });

  it.each([
    ["AUDIO_PWA", "Source : note vocale"],
    ["WHATSAPP_VOICE", "Source : note vocale"],
    ["WHATSAPP_TEXT", "Source : WhatsApp"],
  ] as const)("affiche le badge « %s » → « %s »", (source, libelleAttendu) => {
    const html = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} source={source} />);

    expect(html).toContain(libelleAttendu);
  });

  it.each(["AUDIO_PWA", "WHATSAPP_VOICE"] as const)(
    "cite la transcription telle quelle sous « Lecture du modèle » pour %s, sans troncature",
    (source) => {
      const transcription =
        "Envoie une facture pour quatre sacs de riz à cinquante mille francs guinéens et un transport à douze mille cinq cents";
      const html = renderToStaticMarkup(
        <OcrReviewAlert findings={[ECART_TVA]} source={source} textBrut={transcription} />,
      );

      expect(html).toContain("Lecture du modèle");
      expect(html).toContain(transcription);
    },
  );

  it("cite le message tel quel sous « Message reçu » pour WHATSAPP_TEXT, sans le confondre avec une transcription", () => {
    const message = "4 sacs de riz 25kg, 1 bidon huile 20L, transport 12500";
    const html = renderToStaticMarkup(
      <OcrReviewAlert findings={[ECART_TVA]} source="WHATSAPP_TEXT" textBrut={message} />,
    );

    expect(html).toContain("Message reçu");
    expect(html).toContain(message);
    expect(html).not.toContain("Lecture du modèle");
  });

  it("n'affiche aucun bloc citant le texte quand `textBrut` est null ou vide, même avec une source vocale", () => {
    const htmlNull = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} source="AUDIO_PWA" textBrut={null} />);
    const htmlVide = renderToStaticMarkup(<OcrReviewAlert findings={[ECART_TVA]} source="AUDIO_PWA" textBrut="" />);

    expect(htmlNull).not.toContain("Lecture du modèle");
    expect(htmlVide).not.toContain("Lecture du modèle");
    // Le badge de source, lui, reste affiché : l'absence de texte brut ne dit
    // rien sur la source elle-même.
    expect(htmlNull).toContain("Source : note vocale");
  });

  it("ne pose jamais l'Or de marque ni du texte blanc sur jaune, même avec un badge et une citation", () => {
    const html = renderToStaticMarkup(
      <OcrReviewAlert findings={[ECART_TVA]} source="WHATSAPP_TEXT" textBrut="message brut" />,
    );

    expect(html).not.toMatch(/\b(?:bg|text|border)-yellow\b/);
    expect(html).not.toMatch(/\btext-white\b.*\byellow\b/);
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
