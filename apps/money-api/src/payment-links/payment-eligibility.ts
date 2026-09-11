import type { DisputeStatus, InvoiceStatus } from "@facture-gn/db";

// ── Ce qui autorise, ou non, un encaissement (Chantier 3) ───────────────────
//
// UN SEUL endroit décide, et les deux appelants le lisent : `getPublicCheckout`
// pour désactiver le bouton, `chargeMobileMoney` pour refuser le débit. Deux
// jeux de règles qui devraient dire la même chose finiraient par diverger — et
// la divergence qui coûte cher ici est celle où l'écran bloque mais où le
// serveur laisse passer.
//
// DEUX COLONNES INDÉPENDANTES, jamais une seule (invoice-lifecycle.ts côté web
// énonce le même principe) : `status` dit où en est le DOCUMENT DE COMMERCE,
// `disputeStatus` dit si l'acheteur conteste. Une facture émise ET contestée
// est le cas qui appelle le plus un refus — un `switch` sur le seul `status`
// l'encaisserait sans rien voir.

export type RefusDePaiement =
  | "deja_reglee"
  | "annulee"
  | "en_litige"
  | "non_encaissable";

export interface EligibilitePaiement {
  payable: boolean;
  /** `null` quand payable — jamais une chaîne vide qui obligerait l'appelant à
   *  deviner laquelle des deux valeurs signifie « rien à signaler ». */
  motif: RefusDePaiement | null;
}

// `issued` et `partially_paid` SEULS. La liste est écrite en positif à dessein :
// une liste de refus laisserait tout nouveau statut de l'enum passer en payable
// par défaut, ce qui est exactement le mauvais sens pour un encaissement.
const STATUTS_ENCAISSABLES: ReadonlySet<string> = new Set<InvoiceStatus>([
  "issued",
  "partially_paid",
]);

export function evaluerEligibilite(
  status: InvoiceStatus,
  disputeStatus: DisputeStatus,
): EligibilitePaiement {
  // Le litige passe AVANT le statut : une facture contestée puis soldée
  // resterait « payable » si on regardait `status` d'abord, et un acheteur en
  // litige n'a pas à découvrir qu'il peut encore payer.
  if (disputeStatus === "disputed") {
    return { payable: false, motif: "en_litige" };
  }
  if (status === "paid") {
    return { payable: false, motif: "deja_reglee" };
  }
  if (status === "voided") {
    return { payable: false, motif: "annulee" };
  }
  if (!STATUTS_ENCAISSABLES.has(status)) {
    // draft / converted / expired : jamais des refus à expliquer au payeur.
    // Un brouillon n'a pas d'existence légale, un devis converti a été remplacé
    // par une facture qui porte son propre lien, un devis expiré ne vaut plus
    // son prix. Le motif reste volontairement muet sur lequel des trois.
    return { payable: false, motif: "non_encaissable" };
  }
  return { payable: true, motif: null };
}

// Messages destinés au PAYEUR, jamais au marchand : ils disent quoi faire, pas
// dans quel état est la base. « non_encaissable » ne révèle pas s'il s'agit
// d'un brouillon ou d'un devis expiré — un curieux qui balaierait des
// identifiants n'apprendrait rien de la vie interne du document.
export const MESSAGE_REFUS: Record<RefusDePaiement, string> = {
  deja_reglee: "Cette facture est déjà réglée. Aucun paiement n'est attendu.",
  annulee: "Cette facture a été annulée par le marchand. Ne la réglez pas.",
  en_litige:
    "Cette facture fait l'objet d'une contestation en cours. Le paiement est suspendu tant qu'elle n'est pas tranchée.",
  non_encaissable: "Cette facture n'est pas encaissable en ligne. Contactez le marchand.",
};
