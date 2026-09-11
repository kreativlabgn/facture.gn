import { isSecondaryFinancingLocked } from "@/lib/daf";
import { hasPermission } from "@/lib/permissions";
import type { DisbursementMethod, InvoiceFullDetail } from "@/lib/trust-api";

// ─────────────────────────────────────────────────────────────────────────────
// ARBITRAGE DES RAILS DE FINANCEMENT, CÔTÉ PME — ADR-088/089, K4/K5.
//
// Le pendant actif de `lib/daf.ts`, qui n'en donne que la LECTURE au DAF. Ici
// se joue le seul endroit du produit où `POST /invoices/:id/financing` est
// appelable : c'est la PME qui cède sa créance, jamais l'administration.
//
// Même discipline que la console DAF : tout ce qui DÉCIDE vit ici, jamais dans
// un composant. Et rien de ce fichier n'AUTORISE quoi que ce soit — les deux
// routes portent @Roles("owner","admin") et RolesGuard revérifie chaque appel.
// Ces fonctions décident de ce que l'écran MONTRE ; un bouton masqué n'a jamais
// été un contrôle d'accès.
//
// Les invariants financiers (`isSecondaryFinancingLocked`, `netVerseALaPme`)
// sont IMPORTÉS de daf.ts plutôt que redits : ce sont les mêmes règles ADR-089,
// et deux écrans qui les recopieraient chacun de leur côté finiraient par
// diverger — exactement ce qu'is-financeable.ts interdit côté trust-api.
// ─────────────────────────────────────────────────────────────────────────────

export { netVerseALaPme } from "@/lib/daf";

type EtatFacture = Pick<InvoiceFullDetail, "status" | "disputeStatus" | "financedByPartnerId">;

// Une créance PAYÉE n'a plus rien à financer (le Trésor a réglé), une créance
// ANNULÉE n'existe plus. Ces deux statuts ferment l'arbitrage à l'écran.
//
// L'écart avec trust-api est REFERMÉ depuis l'ADR-121 (2026-09-10) : le serveur
// refuse désormais lui-même `paid`, `partially_paid` et le litige actif, et ne
// laisse passer que `issued`. Cet écran ne masque donc plus un geste que le
// serveur aurait accepté — il ne propose plus un geste que le serveur refuse.
// La distinction reste entière pour autant : un bouton masqué n'a jamais été un
// contrôle d'accès, c'est `is_financeable()` qui décide.
const STATUTS_SANS_ARBITRAGE = new Set(["paid", "voided"]);

// LE LITIGE N'EST PAS UN STATUT, et c'est pour ça qu'il lui faut sa propre
// garde. `disputeStatus` est un champ SÉPARÉ de `status` : une facture peut
// être `issued` ET `disputed` en même temps. L'ajouter au Set ci-dessus aurait
// produit une entrée qu'aucune comparaison n'atteint jamais — un correctif qui
// se lit bien et ne ferme rien.
//
// `resolved` ne bloque pas : le litige est clos, la créance redevient cessible.
// Côté serveur, c'est la même règle (motifCreanceNonCessible, ADR-121), et le
// refus y répond 412 — proposer ici un bouton qui mène à un 412 serait envoyer
// le commerçant contre un mur.
function enLitigeActif(invoice: EtatFacture): boolean {
  return invoice.disputeStatus === "disputed";
}

// Faut-il appeler `GET /invoices/:id/financing/options` en rendant cette page ?
// La question n'est pas cosmétique : la route est @Roles("owner","admin"), donc
// l'appeler pour un cashier ne rapporterait qu'un 403, et l'appeler sur une
// facture morte ne rapporterait rien du tout. Un écran de détail de facture ne
// doit pas payer un aller-retour réseau pour une section qu'il ne rendra pas.
//
// Une facture DÉJÀ CÉDÉE fait exception aux statuts morts : le nom du
// cessionnaire ne vient que de cette route, et c'est précisément l'information
// qu'il faut continuer d'afficher (voir etatArbitrage).
export function doitInterrogerLesRails(role: string, invoice: EtatFacture): boolean {
  if (!hasPermission(role, "invoices:financing")) {
    return false;
  }
  return (
    isSecondaryFinancingLocked(invoice) ||
    (!STATUTS_SANS_ARBITRAGE.has(invoice.status) && !enLitigeActif(invoice))
  );
}

// Les trois états possibles de la section, et rien entre les deux :
//
//   masque  Rien n'est rendu — ni titre, ni carte, ni bouton désactivé « pour
//           information ». L'absence est structurelle, pas un `hidden` que le
//           premier inspecteur d'éléments rouvre.
//   cedee   La créance est vendue. Le formulaire n'existe plus ; à sa place, la
//           confirmation permanente de qui l'a rachetée.
//   ouvert  Les deux rails sont proposés au choix.
export type EtatArbitrage = "masque" | "cedee" | "ouvert";

export function etatArbitrage(input: {
  role: string;
  invoice: EtatFacture;
  // Verdict de trust-api, jamais reconstitué ici : deux des cinq conditions
  // d'is_financeable() (compte acheteur public « verified », rattachement
  // client confirmé) ne sont visibles dans aucun champ de la facture.
  // `null` = la route n'a pas été interrogée, ou a échoué.
  financeable: boolean | null;
}): EtatArbitrage {
  if (!hasPermission(input.role, "invoices:financing")) {
    return "masque";
  }

  // K5 — LA CESSION PRIME TOUT, y compris les statuts morts. Une facture cédée
  // puis marquée payée reste une facture dont la créance appartient à un tiers :
  // effacer cette information de l'écran du commerçant le jour où le Trésor
  // règle serait lui retirer, au pire moment, la seule ligne qui dit à qui va
  // l'argent. Le badge est permanent au sens propre.
  if (isSecondaryFinancingLocked(input.invoice)) {
    return "cedee";
  }

  if (STATUTS_SANS_ARBITRAGE.has(input.invoice.status) || enLitigeActif(input.invoice)) {
    return "masque";
  }

  return input.financeable === true ? "ouvert" : "masque";
}

// ADR-088 / Rail A — les deux modes de décaissement acceptés par le DTO
// (choose-financing.dto.ts). Aucune intégration réelle n'existe dans ce dépôt
// (ni Djomy Payout, ni virement bancaire) : les libellés décrivent le canal
// choisi, jamais un délai ou un frais qu'on ne saurait tenir.
export const DISBURSEMENT_METHODS: readonly {
  value: DisbursementMethod;
  label: string;
  aide: string;
}[] = [
  {
    value: "payment_link_payout",
    label: "Versement mobile money",
    aide: "Sur le numéro rattaché au compte de l'entreprise.",
  },
  {
    value: "bank_transfer",
    label: "Virement bancaire",
    aide: "Sur le compte bancaire déclaré de l'entreprise.",
  },
];

// Rail B — l'attente directe du Trésor. ADR-088 le définit comme une ABSENCE
// d'action : ni route, ni colonne, ni DTO. C'est l'état par défaut de toute
// facture, et le choisir consiste très exactement à ne rien envoyer. Le
// composant le rend donc comme un choix EXPLICITE à l'écran (le commerçant doit
// pouvoir arbitrer en connaissance de cause) mais sans jamais poster quoi que
// ce soit — voir ArbitrageMarchandForm.
