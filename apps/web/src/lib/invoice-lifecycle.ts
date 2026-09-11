// ── Les quatre statuts interopérables du parcours légal (LFI 2025) ───────────
//
// `status` (draft → issued → partially_paid → paid → voided) décrit le DOCUMENT
// DE COMMERCE : puis-je encore le modifier, est-il soldé. Il reste affiché
// ailleurs, par StatusPill, et ce module ne le remplace pas.
//
// Ce module décrit un AUTRE axe : où en est la facture vis-à-vis de
// l'administration et de son acheteur. Quatre colonnes indépendantes le
// portent, écrites par quatre acteurs différents :
//
//   Déposée    etaxStatus = transmitted + etaxReceiptNumber   EtaxSyncProcessor
//   Approuvée  validatedByAdministration                      PublicBuyerPortalService
//   Litige     disputeStatus = disputed                       dispute_raised
//   Encaissée  status = paid                                  PaymentsService
//
// ELLES SONT ORTHOGONALES, et c'est la raison d'être de ce fichier : une
// facture peut être déposée, approuvée, encaissée ET contestée en même temps —
// c'est même la situation qui appelle le plus une décision du commerçant. Un
// `switch` qui n'en retiendrait qu'une, ou un badge « le plus avancé »,
// choisirait à sa place laquelle des trois autres il ignore.

export interface FactureCycleDeVie {
  status: string;
  disputeStatus: string | null;
  validatedByAdministration: boolean;
  etaxStatus: string | null;
  etaxReceiptNumber: string | null;
}

export type CleEtape = "deposee" | "approuvee" | "litige" | "encaissee";

/** `ton` nomme la paire de classes sémantiques de la charte, jamais une
 *  couleur : le JSX ne décide pas de la teinte d'un statut légal. */
export type TonEtape = "succes" | "confiance" | "alerte";

export interface EtapeDuCycle {
  cle: CleEtape;
  label: string;
  /** Ce que l'étape signifie pour le commerçant — une pastille seule dirait un
   *  mot sans dire ce qu'il engage. */
  aide: string;
  ton: TonEtape;
  /** Le litige est le seul qui attende quelque chose du commerçant : il ouvre
   *  l'avoir rectificatif. L'écran lit ce drapeau plutôt que de recomparer la
   *  chaîne "litige" dans son JSX — deux endroits qui décideraient de la même
   *  chose finiraient par en décider différemment. */
  appelleUneAction: boolean;
}

// Un brouillon n'est pas encore un document ; une facture annulée n'en est plus
// un. Dans les deux cas, afficher « Approuvée » sur la foi d'une colonne écrite
// en amont serait un contresens que le lecteur prendrait pour une garantie.
const STATUTS_SANS_PARCOURS = ["draft", "voided"];

export function etapesDuCycle(facture: FactureCycleDeVie): EtapeDuCycle[] {
  if (STATUTS_SANS_PARCOURS.includes(facture.status)) {
    return [];
  }

  const etapes: EtapeDuCycle[] = [];

  // Le REÇU est la preuve, pas le statut. `transmitted` sans numéro est une
  // incohérence de données (le processeur écrit les deux ensemble) : on ne
  // l'annonce pas comme un dépôt, puisque c'est ce numéro que le commerçant
  // devra produire en cas de contrôle. `pending` et `failed` ne sont qu'une
  // intention — la file a avalé la facture, la DGI n'a rien acquitté.
  if (facture.etaxStatus === "transmitted" && facture.etaxReceiptNumber) {
    etapes.push({
      cle: "deposee",
      label: "Déposée",
      aide: `Immatriculée à la DGI — reçu ${facture.etaxReceiptNumber}`,
      ton: "succes",
      appelleUneAction: false,
    });
  }

  if (facture.validatedByAdministration) {
    etapes.push({
      cle: "approuvee",
      label: "Approuvée",
      aide: "Service fait validé par l'acheteur — créance reconnue",
      ton: "confiance",
      appelleUneAction: false,
    });
  }

  // `resolved` n'est pas un litige : le désaccord a été tranché. Le maintenir
  // affiché laisserait une alerte permanente sur une facture réglée.
  if (facture.disputeStatus === "disputed") {
    etapes.push({
      cle: "litige",
      label: "Litige",
      aide: "Contestée par l'acheteur — un avoir rectificatif peut être émis",
      ton: "alerte",
      appelleUneAction: true,
    });
  }

  // `partially_paid` n'est pas encaissé : il reste dû. Le compter ici
  // annoncerait un flux rapproché qui ne l'est qu'à moitié.
  if (facture.status === "paid") {
    etapes.push({
      cle: "encaissee",
      label: "Encaissée",
      aide: "Paiement reçu et rapproché",
      ton: "succes",
      appelleUneAction: false,
    });
  }

  return etapes;
}

// Paires de la charte (CLAUDE.md § couleurs sémantiques) — fond teinté 12 % +
// texte assombri, le ton brut échouant WCAG AA sur son propre fond.
//
// Le litige est AMBRE, pas rouge : c'est une alerte qui attend une décision,
// pas une erreur système. Cela évite en prime de poser un rouge à côté du vert
// de « Déposée » dans une même rangée.
export const CLASSES_TON: Record<TonEtape, string> = {
  succes: "bg-green-bg text-green-text",
  confiance: "bg-blue-bg text-blue-text",
  alerte: "bg-amber-bg text-amber-text",
};
