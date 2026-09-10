import type { BadgeTone } from "@/components/ui";
import type { PublicBuyerInvoice } from "@/lib/trust-api";

// ─────────────────────────────────────────────────────────────────────────────
// Logique de la console acheteur public (DAF) — ADR-080/088/089.
//
// Tout ce qui DÉCIDE vit ici, jamais dans les composants : ces règles portent
// l'invariant anti-double-nantissement (K5) et l'éligibilité au visa de
// liquidation (J1). Un composant qui recopierait l'une d'elles créerait un
// second endroit où la règle peut diverger — exactement ce qu'is-financeable.ts
// interdit côté trust-api, pour la même raison.
//
// Aucune de ces fonctions n'AUTORISE quoi que ce soit : trust-api revérifie la
// chaîne complète (appartenance au compte acheteur public, compte « verified »,
// rattachement client confirmé) à chaque appel. Elles décident de ce que
// l'écran MONTRE — un bouton masqué n'a jamais été un contrôle d'accès.
// ─────────────────────────────────────────────────────────────────────────────

// ADR-088 — les deux rails d'arbitrage de la liquidation.
//
//   Rail A  La créance a été cédée à un partenaire financier agréé : la PME a
//           été payée par avance, et c'est le partenaire qui attend le
//           règlement de l'administration. Le rail se LIT sur la facture
//           (financedByPartnerId), il ne se choisit jamais depuis cet écran.
//   Rail B  Aucun financement — règlement direct à l'échéance, 0 % de
//           commission. ADR-088 le définit comme une ABSENCE d'action : il n'a
//           aucune donnée propre, c'est l'état par défaut de toute facture.
export type FinancingRail = "A" | "B";

export function railOf(invoice: Pick<PublicBuyerInvoice, "financedByPartnerId">): FinancingRail {
  return invoice.financedByPartnerId !== null ? "A" : "B";
}

// K5, ADR-089 — L'INVARIANT CENTRAL DE CET ÉCRAN.
//
// La seule présence de financedByPartnerId vaut créance déjà cédée. Dès qu'il
// est renseigné, toute action de rachat secondaire doit être structurellement
// absente de l'interface — pas grisée « pour information », pas masquée par un
// `hidden` que le premier inspecteur d'éléments rouvre : jamais rendue.
//
// Le nom dit la conclusion, pas la donnée, pour que l'appelant ne soit jamais
// tenté de retester `financedByPartnerId` lui-même.
export function isSecondaryFinancingLocked(
  invoice: Pick<PublicBuyerInvoice, "financedByPartnerId">,
): boolean {
  return invoice.financedByPartnerId !== null;
}

// J1 — le visa de liquidation est un acte de l'administration cliente, posé une
// seule fois. Le service est idempotent (un second appel ne crée pas un second
// InvoiceEvent), mais l'écran n'a aucune raison de proposer un geste sans effet.
//
// draft et voided sont exclus pour des motifs distincts, jamais confondus :
// une facture jamais émise ne porte aucune créance à reconnaître ; une facture
// annulée n'en porte plus (PRD §4.2). Les deux refus viennent du service en
// 409 — cette fonction ne fait que ne pas les provoquer inutilement.
const STATUTS_SANS_CREANCE = new Set(["draft", "voided"]);

export function canValidateLiquidation(
  invoice: Pick<PublicBuyerInvoice, "status" | "validatedByAdministration">,
): boolean {
  return !invoice.validatedByAdministration && !STATUTS_SANS_CREANCE.has(invoice.status);
}

// Avancement du visa, tel que la colonne « Liquidation » le rend. Distinct du
// statut de PAIEMENT (StatusPill) : une facture peut être visée sans être
// payée, et payée sans avoir jamais été visée. Les mélanger dans une seule
// pastille ferait lire « payé » là où l'administration n'a encore rien reconnu
// (ADR-080 : liquidation ≠ ordonnancement ≠ paiement).
export type LiquidationStage = "non_visee" | "visee" | "cedee" | "sans_objet";

export function liquidationStage(
  invoice: Pick<PublicBuyerInvoice, "status" | "validatedByAdministration" | "financedByPartnerId">,
): LiquidationStage {
  if (STATUTS_SANS_CREANCE.has(invoice.status)) {
    return "sans_objet";
  }
  // La cession prime l'affichage : une créance cédée est nécessairement déjà
  // visée (is_financeable() l'exige côté trust-api), et c'est l'information la
  // plus lourde de conséquence pour le DAF — c'est au partenaire qu'il devra
  // régler, plus au fournisseur.
  if (invoice.financedByPartnerId !== null) {
    return "cedee";
  }
  return invoice.validatedByAdministration ? "visee" : "non_visee";
}

export const LIQUIDATION_STAGE_LABELS: Record<LiquidationStage, { label: string; glyph: string; tone: BadgeTone }> = {
  non_visee: { label: "À viser", glyph: "○", tone: "amber" },
  visee: { label: "Service fait visé", glyph: "●", tone: "green" },
  cedee: { label: "Créance cédée", glyph: "◆", tone: "blue" },
  sans_objet: { label: "Sans objet", glyph: "○", tone: "navy" },
};

// ADR-089 / RAIL A — CE QUE LA PME REÇOIT.
//
// Les frais de décaissement sont portés par l'établissement financier, jamais
// déduits du montant certifié : le net versé à la PME est donc, par
// construction, le total TTC de la facture — pas un montant à recalculer.
// La fonction existe malgré sa trivialité pour que cette règle ait UN nom et UN
// endroit, plutôt que d'être un `invoice.totalTtc` anonyme dans un composant
// où le prochain lecteur ne saurait pas si un frais a été oublié.
//
// Le taux lui-même (`payout_fee_djomy_bps`, ADR-089) n'existe NULLE PART dans
// ce dépôt — ni colonne, ni valeur, ni intégration Djomy Payout (écarté
// explicitement par les plans du 09/08 et du 19/08 : « un frais sur un virement
// qui n'a jamais lieu n'a aucun effet réel »). L'écran affiche donc la CHARGE
// (qui paie) sans jamais afficher de MONTANT de frais : inventer un chiffre sur
// un écran comptable serait pire que ne rien afficher.
export function netVerseALaPme(invoice: Pick<PublicBuyerInvoice, "totalTtc">): string {
  return invoice.totalTtc;
}

// Référence métier affichée en tête de ligne. GET /public-buyer/invoices ne
// renvoie AUCUNE relation — pas de nom de fournisseur, pas de nom de client
// (voir PublicBuyerInvoice). On rend donc la référence la plus parlante pour un
// acheteur public, dans l'ordre décroissant de spécificité du circuit de la
// dépense, et jamais un libellé inventé : à défaut, l'identifiant technique.
export function referenceDepense(
  invoice: Pick<PublicBuyerInvoice, "numeroEngagement" | "numeroBonCommande" | "referenceMarche" | "number" | "id">,
): { label: string; value: string } {
  if (invoice.numeroEngagement) {
    return { label: "Engagement", value: invoice.numeroEngagement };
  }
  if (invoice.numeroBonCommande) {
    return { label: "Bon de commande", value: invoice.numeroBonCommande };
  }
  if (invoice.referenceMarche) {
    return { label: "Marché", value: invoice.referenceMarche };
  }
  if (invoice.number) {
    return { label: "Facture", value: invoice.number };
  }
  return { label: "Référence interne", value: invoice.id };
}
