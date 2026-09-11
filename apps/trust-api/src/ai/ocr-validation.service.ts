import { Injectable } from "@nestjs/common";
import { computeTaxBreakdown } from "../invoices/tax-regime";
import type { OcrExtraction } from "./schemas/ocr-extraction.schema";

// Double-garde mathématique du Hub Vision (ADR-122 §2).
//
// Le modèle est un ORACLE FAILLIBLE : il lit des chiffres manuscrits, sous un
// éclairage de marché, sur un carnet à souche parfois froissé. Il peut lire
// « 8 » pour « 3 », sauter une ligne, ou reconstituer un total qui « a l'air »
// juste. Ce service ne lui fait confiance sur RIEN qui se recalcule : chaque
// égalité arithmétique que le papier devrait respecter est vérifiée en BigInt,
// et le PREMIER centime d'écart suffit à bloquer l'insertion automatique.
//
// Deux gardes, délibérément distinctes :
//   1. LIGNES — quantité × prix unitaire = total de ligne, et Σ totaux de ligne
//      = le total de pied correspondant au régime (HT sous HT_FIRST, TTC sous
//      TTC_FIRST — ADR-108). Ce sont les erreurs de LECTURE (un chiffre
//      confondu) et de CALCUL du carnet (le commerçant s'est trompé en
//      additionnant).
//   2. TAXES — HT + TVA = TTC, et la TVA vaut EXACTEMENT ce que le régime fiscal
//      de l'organisation impose. Le taux ne vient JAMAIS du modèle ni du papier
//      (C4, ADR-033 « jamais un taux TVA plat ») : il vient de
//      resolveTaxRateBps(organization.regimeFiscal), résolu par l'appelant. Un
//      carnet qui affiche de la TVA chez une organisation en TPU est un écart —
//      c'est exactement la facture qu'on ne doit PAS insérer sans une main
//      humaine.
//
// Aucune tolérance, aucun arrondi « bienveillant ». Un carnet qui arrondit sa
// TVA au demi-centime supérieur là où le serveur tronque produit un écart d'un
// centime — et c'est VOULU : le serveur ne devine pas la règle d'arrondi du
// papier, il demande à quelqu'un de relire. Un brouillon inséré à un centime
// près serait certifié Ed25519 avec des totaux qui ne se resomment pas.
//
// Service PUR : aucune I/O, aucune dépendance injectée. C'est ce qui le rend
// exhaustivement testable en unitaire, et ce qui garantit que la décision est
// la même quel que soit le chemin qui l'appelle.

export const OCR_ECART_CODES = ["LIGNE_TOTAL", "SOMME_LIGNES", "TOTAL_TTC", "TVA_REGIME"] as const;
export type OcrEcartCode = (typeof OCR_ECART_CODES)[number];

/** Un écart relevé, rendu tel quel au front (OcrReviewAlert). Les montants
 *  sont des chaînes de centimes : ils traversent JSON sans perte, et le front
 *  (ES2017) n'a pas à manipuler de BigInt. */
export type OcrEcart = {
  code: OcrEcartCode;
  /** Chemin dans l'extraction, au format Zod (`lines.2.lineTotal`, `totals.totalVAT`). */
  chemin: string;
  attendu: string;
  constate: string;
};

export type OcrMontantsValides = {
  totalHt: bigint;
  totalTva: bigint;
  totalTtc: bigint;
};

export type OcrValidationVerdict =
  | { conforme: true; montants: OcrMontantsValides; ecarts: [] }
  | { conforme: false; ecarts: OcrEcart[] };

const BPS_DENOMINATEUR = BigInt(10_000);

@Injectable()
export class OcrValidationService {
  /**
   * @param taxRateBps taux du RÉGIME FISCAL de l'organisation (resolveTaxRateBps),
   *   jamais une valeur lue sur le document.
   */
  valider(extraction: OcrExtraction, taxRateBps: number): OcrValidationVerdict {
    const ecarts: OcrEcart[] = [...this.verifierLignes(extraction), ...this.verifierTaxes(extraction, taxRateBps)];

    if (ecarts.length > 0) {
      return { conforme: false, ecarts };
    }

    const { totalHT, totalVAT, totalTTC } = extraction.totals;
    return { conforme: true, montants: { totalHt: totalHT, totalTva: totalVAT, totalTtc: totalTTC }, ecarts: [] };
  }

  // ── Garde 1 : cohérence des lignes ────────────────────────────────────────
  private verifierLignes(extraction: OcrExtraction): OcrEcart[] {
    const ecarts: OcrEcart[] = [];
    let sommeLignes = BigInt(0);

    extraction.lines.forEach((ligne, index) => {
      const attendu = ligne.unitPrice * BigInt(ligne.quantity);
      if (attendu !== ligne.lineTotal) {
        ecarts.push({
          code: "LIGNE_TOTAL",
          chemin: `lines.${index}.lineTotal`,
          attendu: attendu.toString(),
          constate: ligne.lineTotal.toString(),
        });
      }
      // On somme ce qui est ÉCRIT, pas ce qui est recalculé : si une ligne est
      // fausse ET que le pied de facture a été additionné depuis cette ligne
      // fausse, la somme des totaux écrits retombe sur le pied — et seul l'écart
      // de ligne est relevé, au bon endroit. Sommer les recalculs produirait un
      // second écart en pied, redondant et trompeur pour la relecture.
      sommeLignes += ligne.lineTotal;
    });

    // ADR-108 : la colonne de pied contre laquelle les lignes se resomment
    // dépend du régime. Sous HT_FIRST les prix unitaires sont HT, la somme
    // doit tomber sur le total HT ; sous TTC_FIRST, sur le TTC.
    const [cheminPied, totalPied] =
      extraction.saisieRegime === "HT_FIRST"
        ? (["totals.totalHT", extraction.totals.totalHT] as const)
        : (["totals.totalTTC", extraction.totals.totalTTC] as const);

    if (sommeLignes !== totalPied) {
      ecarts.push({
        code: "SOMME_LIGNES",
        chemin: cheminPied,
        attendu: sommeLignes.toString(),
        constate: totalPied.toString(),
      });
    }

    return ecarts;
  }

  // ── Garde 2 : cohérence fiscale ───────────────────────────────────────────
  private verifierTaxes(extraction: OcrExtraction, taxRateBps: number): OcrEcart[] {
    const ecarts: OcrEcart[] = [];
    const { totalHT, totalVAT, totalTTC } = extraction.totals;

    const ttcAttendu = totalHT + totalVAT;
    if (ttcAttendu !== totalTTC) {
      ecarts.push({
        code: "TOTAL_TTC",
        chemin: "totals.totalTTC",
        attendu: ttcAttendu.toString(),
        constate: totalTTC.toString(),
      });
    }

    // Deux formules, UNE par régime, et jamais la même appliquée aux deux :
    //   • HT_FIRST — la TVA se calcule DEPUIS le HT écrit : HT × taux, tronqué.
    //   • TTC_FIRST — le HT se DÉDUIT du TTC écrit (convention TTC-first du
    //     parcours marchand, C4) : on passe par computeTaxBreakdown, l'unique
    //     point de calcul que createDraft() et convertToInvoice() utilisent
    //     déjà, pour que le brouillon inséré soit ventilé EXACTEMENT comme un
    //     brouillon saisi à la main l'aurait été.
    const tvaAttendue =
      extraction.saisieRegime === "HT_FIRST"
        ? (totalHT * BigInt(taxRateBps)) / BPS_DENOMINATEUR
        : computeTaxBreakdown(totalTTC, taxRateBps).totalTva;

    if (tvaAttendue !== totalVAT) {
      ecarts.push({
        code: "TVA_REGIME",
        chemin: "totals.totalVAT",
        attendu: tvaAttendue.toString(),
        constate: totalVAT.toString(),
      });
    }

    return ecarts;
  }
}
