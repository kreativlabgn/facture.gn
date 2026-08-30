import type { RegimeFiscal } from "@facture-gn/db";
import { resolveTaxRateBps } from "../invoices/tax-regime";

// Mentions légales portées au pied d'une facture, selon le régime fiscal de
// l'organisation émettrice. Le taux de TVA n'est JAMAIS écrit en dur ici — il
// est dérivé de resolveTaxRateBps() (seule source de vérité, C4 / ADR-033), pour
// qu'une facture et sa mention ne puissent pas afficher deux taux différents.
//
// RESTE EN FRANÇAIS quelle que soit l'Organization.preferredLanguage — la facture
// est un document légal (langue officielle OHADA / Guinée). Le lot i18n
// (apps/trust-api/src/i18n, ADR-051 : voix > traduction texte) ne traduit que le
// texte SMS/WhatsApp sortant, jamais le PDF ni les menus USSD.
//
// Le libellé exact des sanctions de retard n'est pas fixé par les specs
// (Backlog / DAT / CdC / ADR) — formulation OHADA générique volontairement sans
// taux chiffré ni référence d'article (le CGI guinéen n'est pas modélisé dans ce
// repo). À préciser si une story dédiée aux mentions légales apparaît.
const LATE_PAYMENT_MENTION =
  "Tout retard de paiement entraîne l'exigibilité de pénalités de retard, sans qu'un rappel préalable soit nécessaire.";

export function legalMentionsFor(regime: RegimeFiscal): string[] {
  const rateBps = resolveTaxRateBps(regime);

  const taxMention =
    rateBps > 0
      ? `TVA au taux de ${rateBps / 100} % incluse dans le montant TTC.`
      : taxExemptionMention(regime);

  return [taxMention, LATE_PAYMENT_MENTION];
}

function taxExemptionMention(regime: RegimeFiscal): string {
  switch (regime) {
    case "tpu":
      return "Taxe Professionnelle Unique (TPU) — régime du forfait : la TVA n'est pas facturée, l'impôt étant forfaitaire sur le chiffre d'affaires.";
    case "non_assujetti_association":
      return "Organisme non assujetti — TVA non applicable.";
    case "normal_sans_tva":
      return "TVA non applicable.";
    case "normal_tva":
      // rateBps > 0 pour normal_tva : cette branche n'est jamais atteinte, mais
      // le switch reste exhaustif (garde de compilation si un régime est ajouté).
      return "TVA non applicable.";
    default:
      return "TVA non applicable.";
  }
}
