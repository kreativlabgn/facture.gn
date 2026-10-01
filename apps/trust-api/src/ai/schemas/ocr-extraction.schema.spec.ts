import { describe, expect, it } from "vitest";
import { OCR_CENTIMES_PATTERN, ocrExtractionSchema } from "./ocr-extraction.schema";

// Sortie « propre » d'un carnet pro (HT_FIRST, TVA 18 %) : 2 × 500 000,00 GNF
// + 3 × 100 000,00 GNF = 1 300 000,00 HT ; TVA 234 000,00 ; TTC 1 534 000,00.
const LECTURE_VALIDE = {
  documentNumber: "CARNET-0042",
  issueDate: "2026-09-10",
  customer: { name: "Boutique Fatoumata", nif: "123456789" },
  saisieRegime: "HT_FIRST",
  lines: [
    { description: "Sacs de riz 50 kg", quantity: 2, unitPrice: "50000000", lineTotal: "100000000" },
    { description: "Bidons d'huile 20 L", quantity: 3, unitPrice: "10000000", lineTotal: "30000000" },
  ],
  totals: { totalHT: "130000000", totalVAT: "23400000", totalTTC: "153400000" },
  confidence: 0.93,
};

describe("ocrExtractionSchema (ADR-122)", () => {
  it("accepte une lecture complète et convertit chaque montant en BigInt centimal", () => {
    const parsed = ocrExtractionSchema.parse(LECTURE_VALIDE);

    expect(parsed.totals.totalHT).toBe(BigInt(130_000_000));
    expect(parsed.totals.totalVAT).toBe(BigInt(23_400_000));
    expect(parsed.totals.totalTTC).toBe(BigInt(153_400_000));
    expect(parsed.lines[0].unitPrice).toBe(BigInt(50_000_000));
    expect(parsed.lines[1].lineTotal).toBe(BigInt(30_000_000));
    expect(parsed.issueDate).toBeInstanceOf(Date);
  });

  it("transporte les deux régimes de saisie de l'ADR-108 tels quels", () => {
    expect(ocrExtractionSchema.parse(LECTURE_VALIDE).saisieRegime).toBe("HT_FIRST");
    expect(ocrExtractionSchema.parse({ ...LECTURE_VALIDE, saisieRegime: "TTC_FIRST" }).saisieRegime).toBe("TTC_FIRST");
  });

  it("refuse un régime de saisie inconnu ou absent — jamais deviné côté serveur", () => {
    expect(ocrExtractionSchema.safeParse({ ...LECTURE_VALIDE, saisieRegime: "MIXTE" }).success).toBe(false);
    expect(ocrExtractionSchema.safeParse({ ...LECTURE_VALIDE, saisieRegime: undefined }).success).toBe(false);
  });

  // LA garantie de précision. Un modèle qui rend un `number` a déjà fait passer
  // son montant par un flottant avant que notre code ne s'exécute.
  it("refuse un montant transmis en nombre plutôt qu'en chaîne", () => {
    const resultat = ocrExtractionSchema.safeParse({
      ...LECTURE_VALIDE,
      totals: { ...LECTURE_VALIDE.totals, totalHT: 130_000_000 },
    });

    expect(resultat.success).toBe(false);
  });

  it("refuse tout ce qui n'est pas une chaîne de chiffres seuls : décimale, signe, espace, exposant", () => {
    for (const montant of ["1300000.00", "-1300000", "1 300 000", "1.3e8", "", "12a"]) {
      const resultat = ocrExtractionSchema.safeParse({
        ...LECTURE_VALIDE,
        totals: { ...LECTURE_VALIDE.totals, totalTTC: montant },
      });
      expect(resultat.success, `« ${montant} » aurait dû être refusé`).toBe(false);
    }
    expect(OCR_CENTIMES_PATTERN.test("0")).toBe(true);
  });

  // Au-delà de Number.MAX_SAFE_INTEGER (9 007 199 254 740 991) un `number`
  // aurait déjà perdu des chiffres ; la chaîne, elle, arrive intacte.
  it("conserve chiffre pour chiffre un montant hors de la précision d'un flottant", () => {
    const enorme = "12345678901234567"; // 17 chiffres
    const parsed = ocrExtractionSchema.parse({
      ...LECTURE_VALIDE,
      totals: { ...LECTURE_VALIDE.totals, totalTTC: enorme },
    });

    expect(parsed.totals.totalTTC.toString()).toBe(enorme);
  });

  it("borne les montants à 17 chiffres — un modèle qui hallucine n'insère pas un BigInt de plusieurs kilo-octets", () => {
    const resultat = ocrExtractionSchema.safeParse({
      ...LECTURE_VALIDE,
      totals: { ...LECTURE_VALIDE.totals, totalTTC: "1".repeat(18) },
    });

    expect(resultat.success).toBe(false);
  });

  it("refuse une quantité nulle, négative ou fractionnaire", () => {
    for (const quantity of [0, -1, 1.5]) {
      const resultat = ocrExtractionSchema.safeParse({
        ...LECTURE_VALIDE,
        lines: [{ ...LECTURE_VALIDE.lines[0], quantity }],
      });
      expect(resultat.success).toBe(false);
    }
  });

  it("refuse une lecture sans ligne — une facture sans ligne ne se certifie pas (OHADA Article 23)", () => {
    expect(ocrExtractionSchema.safeParse({ ...LECTURE_VALIDE, lines: [] }).success).toBe(false);
  });

  it("accepte une vente anonyme (customer absent) et une date absente", () => {
    const parsed = ocrExtractionSchema.parse({
      ...LECTURE_VALIDE,
      customer: undefined,
      issueDate: undefined,
      confidence: undefined,
    });

    expect(parsed.customer).toBeUndefined();
    expect(parsed.issueDate).toBeUndefined();
  });

  it("refuse une confiance hors [0, 1]", () => {
    expect(ocrExtractionSchema.safeParse({ ...LECTURE_VALIDE, confidence: 1.2 }).success).toBe(false);
  });

  // L'organisation vient du garde, jamais du modèle : une valeur glissée dans
  // la sortie n'atteint pas le service.
  it("élague un organizationId glissé dans la sortie du modèle", () => {
    const parsed = ocrExtractionSchema.parse({ ...LECTURE_VALIDE, organizationId: "org-de-la-victime" });

    expect(parsed).not.toHaveProperty("organizationId");
  });

  // Régression verrouillant la clarification 1 du plan 2026-09-16 (OCR
  // multicanal) : le contrat Zod reste UNIQUE, sans buyerPhone. Le numéro
  // (PWA ou WhatsApp) se résout AVANT d'entrer dans ce contrat, côté service —
  // jamais une propriété que le modèle, ou quiconque rejoue sa sortie,
  // contrôlerait.
  it("élague un buyerPhone glissé dans la sortie du modèle — jamais ajouté au contrat", () => {
    const parsed = ocrExtractionSchema.parse({ ...LECTURE_VALIDE, buyerPhone: "+224622334455" });

    expect(parsed).not.toHaveProperty("buyerPhone");
  });
});
