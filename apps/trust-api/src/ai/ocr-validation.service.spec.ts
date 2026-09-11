import { describe, expect, it } from "vitest";
import { OcrValidationService } from "./ocr-validation.service";
import type { OcrExtraction } from "./schemas/ocr-extraction.schema";

const TVA_18 = 1800;
const TPU = 0;

// Carnet pro (HT_FIRST) : 2 × 500 000,00 + 3 × 100 000,00 = 1 300 000,00 HT ;
// TVA 18 % = 234 000,00 ; TTC 1 534 000,00.
function carnetHt(overrides: Partial<OcrExtraction> = {}): OcrExtraction {
  return {
    saisieRegime: "HT_FIRST",
    lines: [
      { description: "Sacs de riz 50 kg", quantity: 2, unitPrice: BigInt(50_000_000), lineTotal: BigInt(100_000_000) },
      { description: "Bidons d'huile 20 L", quantity: 3, unitPrice: BigInt(10_000_000), lineTotal: BigInt(30_000_000) },
    ],
    totals: { totalHT: BigInt(130_000_000), totalVAT: BigInt(23_400_000), totalTTC: BigInt(153_400_000) },
    ...overrides,
  };
}

// Carnet de détail (TTC_FIRST) : prix affichés TTC. 2 × 590 000,00 + 1 ×
// 354 000,00 = 1 534 000,00 TTC ; HT dérivé 1 300 000,00 ; TVA 234 000,00.
function carnetTtc(overrides: Partial<OcrExtraction> = {}): OcrExtraction {
  return {
    saisieRegime: "TTC_FIRST",
    lines: [
      { description: "Pagnes wax", quantity: 2, unitPrice: BigInt(59_000_000), lineTotal: BigInt(118_000_000) },
      { description: "Chaussures", quantity: 1, unitPrice: BigInt(35_400_000), lineTotal: BigInt(35_400_000) },
    ],
    totals: { totalHT: BigInt(130_000_000), totalVAT: BigInt(23_400_000), totalTTC: BigInt(153_400_000) },
    ...overrides,
  };
}

describe("OcrValidationService — double-garde mathématique (ADR-122 §2)", () => {
  const service = new OcrValidationService();

  it("valide un carnet HT_FIRST cohérent au centime près et rend les montants à insérer", () => {
    const verdict = service.valider(carnetHt(), TVA_18);

    expect(verdict.conforme).toBe(true);
    if (verdict.conforme) {
      expect(verdict.montants).toEqual({
        totalHt: BigInt(130_000_000),
        totalTva: BigInt(23_400_000),
        totalTtc: BigInt(153_400_000),
      });
      expect(verdict.ecarts).toEqual([]);
    }
  });

  it("valide un carnet TTC_FIRST cohérent, la TVA étant déduite du TTC comme sur le parcours marchand", () => {
    const verdict = service.valider(carnetTtc(), TVA_18);

    expect(verdict.conforme).toBe(true);
  });

  // ── Garde 1 : lignes ──────────────────────────────────────────────────────

  it("relève UN centime d'écart sur un total de ligne (lecture « 8 » pour « 3 »)", () => {
    const carnet = carnetHt();
    carnet.lines[0].lineTotal = BigInt(100_000_001);
    // Le pied a été additionné depuis la ligne fausse : seule la ligne est en cause.
    carnet.totals = { totalHT: BigInt(130_000_001), totalVAT: BigInt(23_400_000), totalTTC: BigInt(153_400_001) };

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts).toEqual([
      { code: "LIGNE_TOTAL", chemin: "lines.0.lineTotal", attendu: "100000000", constate: "100000001" },
      // 130 000 001 × 18 % = 23 400 000,18 → tronqué 23 400 000 : la TVA écrite
      // reste juste, aucun second écart n'est inventé en pied.
    ]);
  });

  it("relève à la fois la ligne fausse ET la somme, quand le pied ne découle pas de la ligne fausse", () => {
    const carnet = carnetHt();
    carnet.lines[1].lineTotal = BigInt(30_000_100);

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts.map((e) => e.code)).toEqual(["LIGNE_TOTAL", "SOMME_LIGNES"]);
    expect(verdict.ecarts[1]).toEqual({
      code: "SOMME_LIGNES",
      chemin: "totals.totalHT",
      attendu: "130000100",
      constate: "130000000",
    });
  });

  it("resomme les lignes contre le TTC sous TTC_FIRST, jamais contre le HT (ADR-108)", () => {
    const carnet = carnetTtc();
    carnet.lines[0].lineTotal = BigInt(118_000_000);
    carnet.lines[1].lineTotal = BigInt(35_400_001);
    carnet.lines[1].unitPrice = BigInt(35_400_001);

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts.map((e) => `${e.code}@${e.chemin}`)).toContain("SOMME_LIGNES@totals.totalTTC");
    expect(verdict.ecarts.map((e) => e.chemin)).not.toContain("totals.totalHT");
  });

  // ── Garde 2 : taxes ───────────────────────────────────────────────────────

  it("relève UN centime d'écart sur la TVA, même quand HT + TVA = TTC reste vrai", () => {
    const carnet = carnetHt({
      totals: { totalHT: BigInt(130_000_000), totalVAT: BigInt(23_400_001), totalTTC: BigInt(153_400_001) },
    });

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts).toEqual([
      { code: "TVA_REGIME", chemin: "totals.totalVAT", attendu: "23400000", constate: "23400001" },
    ]);
  });

  it("relève un TTC qui n'est pas HT + TVA", () => {
    const carnet = carnetHt({
      totals: { totalHT: BigInt(130_000_000), totalVAT: BigInt(23_400_000), totalTTC: BigInt(153_500_000) },
    });

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts).toEqual([
      { code: "TOTAL_TTC", chemin: "totals.totalTTC", attendu: "153400000", constate: "153500000" },
    ]);
  });

  // LE cas de Madina. Le taux vient du régime de l'organisation, jamais du
  // papier : une TVA « lue » chez un commerçant en TPU est un écart, pas une
  // donnée. Sans cette garde, une organisation qui n'a pas le droit de
  // collecter de TVA insérerait un brouillon qui en affiche.
  it("refuse une TVA lue sur le papier quand l'organisation est en TPU (taux 0)", () => {
    const verdict = service.valider(carnetHt(), TPU);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts).toEqual([
      { code: "TVA_REGIME", chemin: "totals.totalVAT", attendu: "0", constate: "23400000" },
    ]);
  });

  it("valide un carnet TPU sans TVA", () => {
    const carnet = carnetHt({
      totals: { totalHT: BigInt(130_000_000), totalVAT: BigInt(0), totalTTC: BigInt(130_000_000) },
    });

    expect(service.valider(carnet, TPU).conforme).toBe(true);
  });

  // Un carnet qui arrondit sa TVA autrement que le serveur (demi-centime
  // supérieur vs troncature) produit UN centime d'écart — et c'est voulu : le
  // serveur ne devine pas la règle d'arrondi du papier.
  it("ne tolère aucune divergence d'arrondi : 1,00 GNF TTC à 18 % → TVA 0,16 attendue, 0,15 écrite = relecture", () => {
    const carnet = carnetTtc({
      lines: [{ description: "Bonbon", quantity: 1, unitPrice: BigInt(100), lineTotal: BigInt(100) }],
      totals: { totalHT: BigInt(85), totalVAT: BigInt(15), totalTTC: BigInt(100) },
    });

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts).toEqual([
      { code: "TVA_REGIME", chemin: "totals.totalVAT", attendu: "16", constate: "15" },
    ]);
  });

  it("accumule tous les écarts d'un document au lieu de s'arrêter au premier — la relecture les voit tous", () => {
    const carnet = carnetHt();
    carnet.lines[0].lineTotal = BigInt(1);
    carnet.totals = { totalHT: BigInt(1), totalVAT: BigInt(1), totalTTC: BigInt(1) };

    const verdict = service.valider(carnet, TVA_18);

    expect(verdict.conforme).toBe(false);
    expect(verdict.ecarts.map((e) => e.code)).toEqual(["LIGNE_TOTAL", "SOMME_LIGNES", "TOTAL_TTC", "TVA_REGIME"]);
  });
});
