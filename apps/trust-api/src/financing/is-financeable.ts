// K4, ADR-031 — "règle composite unique is_financeable(), toute modification
// est un ADR". Composite retenu (voir PLAN "Clarifications") : le seul
// composant explicitement documenté par ADR-080 (validatedByAdministration)
// + l'anti-double-financement (K5, ADR-089) + une garde de bon sens (jamais
// une facture annulée). Fonction unique, jamais dupliquée ailleurs.
//
// Security Audit 2026-08-23, finding #1 (CRITIQUE) — 4e condition ajoutée :
// publicBuyerAccountVerified. validatedByAdministration ne peut être posé que
// par PublicBuyerPortalService.validateLiquidation() (seul writer dans tout le
// repo), donc n'importe quel PublicBuyerAccount "pending" auto-créé permettait
// jusqu'ici de rendre une facture finançable en s'auto-validant. Sans rapport
// avec les factures non-B2G : leur validatedByAdministration reste toujours
// false, cette 4e condition n'affecte jamais leur résultat.
//
// Security Audit 2026-08-23, revue post-fix #1 — 5e condition ajoutée :
// publicEntityConfirmed. La 4e condition seule vérifie le statut LIVE du
// PublicBuyerAccount actuellement lié, jamais si CE lien précis est celui qui a
// réellement produit la validation. Sans elle, une PME pouvait faire valider sa
// liquidation par son propre compte "pending" auto-créé (aucune garde ne
// bloquait validateLiquidation() côté compte non-vérifié — corrigé séparément
// dans PublicBuyerPortalService), PUIS repointer ensuite le même client vers un
// vrai compte déjà "verified" (flagPublicEntity(), sans consentement de ce
// compte) pour satisfaire cette 4e condition après coup, sans jamais repasser
// par une vraie validation. flagPublicEntity() réinitialise désormais
// isPublicEntityConfirmed ET validatedByAdministration à chaque repointage —
// cette 5e condition est ce qui rend cette réinitialisation effective ici.

// Durcissement 2026-09-10 (anti-double-encaissement du Capital Layer) — 6e et
// 7e conditions. ADR-031 pose que ce composite est unique et que « toute
// modification est un ADR » : celle-ci en demande un, elle n'est pas une
// retouche cosmétique. Jusqu'ici le prédicat n'excluait que `voided`, si bien
// qu'une facture B2G visée par l'administration PUIS réglée par le Trésor
// restait finançable côté serveur — un partenaire pouvait racheter une créance
// déjà encaissée. L'écran de la PME la masquait déjà
// (STATUTS_SANS_ARBITRAGE, apps/web/src/lib/financing.ts), mais un masquage
// d'interface n'est pas une garde : l'API répondait 200.
//
// Le statut est désormais une LISTE EN POSITIF, jamais une liste d'exclusions
// (même discipline que payment-eligibility.ts côté money-api) : un statut
// ajouté demain à l'enum InvoiceStatus n'est pas finançable par défaut, il faut
// l'inscrire ici pour qu'il le devienne.
//
// `partially_paid` en est volontairement ABSENT. Le décaissement est tracé à
// `invoice.totalTtc` (voir l'événement financing_disbursed de
// chooseFinancing()), c'est-à-dire à la valeur faciale : financer une facture
// déjà réglée pour moitié rachèterait une deuxième fois la moitié encaissée.
// L'admettre suppose d'abord de financer `amountDue` et non `totalTtc` — c'est
// un autre chantier, et un autre ADR.
export const STATUTS_FINANCABLES = ["issued"] as const;

/** Pourquoi une créance ne peut plus être cédée. `null` = rien ne s'y oppose.
 *
 *  Séparé du prédicat parce que le refus doit pouvoir être NOMMÉ : « déjà
 *  financée » et « déjà encaissée » sont deux situations distinctes pour la PME
 *  comme pour le partenaire, et un 409 unique les confondait. */
export type MotifCreanceNonCessible = "deja_encaissee" | "en_litige";

export function motifCreanceNonCessible(invoice: {
  status: string;
  disputeStatus: string;
}): MotifCreanceNonCessible | null {
  // Une facture réglée n'est plus une créance : il n'y a plus rien à racheter.
  if (invoice.status === "paid") return "deja_encaissee";
  // `disputeStatus` est un champ SÉPARÉ de `status`, jamais une valeur de
  // l'enum : une facture peut être émise ET contestée en même temps. Un
  // prédicat qui ne regarderait que `status` encaisserait la cession d'une
  // créance dont le montant est justement en discussion. `resolved` ne bloque
  // pas — le litige est clos, la créance redevient cessible.
  if (invoice.disputeStatus === "disputed") return "en_litige";
  return null;
}

export function isFinanceable(invoice: {
  validatedByAdministration: boolean;
  financedByPartnerId: string | null;
  status: string;
  disputeStatus: string;
  publicBuyerAccountVerified: boolean;
  publicEntityConfirmed: boolean;
}): boolean {
  return (
    invoice.validatedByAdministration &&
    invoice.financedByPartnerId === null &&
    (STATUTS_FINANCABLES as readonly string[]).includes(invoice.status) &&
    motifCreanceNonCessible(invoice) === null &&
    invoice.publicBuyerAccountVerified &&
    invoice.publicEntityConfirmed
  );
}

// Reproduit les 7 conditions de isFinanceable() sous forme de clause Prisma
// `where` — c'est cette clause, pas isFinanceable(), qui protège réellement
// contre la concurrence au moment du commit (voir chooseFinancing()). Extrait
// ici (revue dev-domain-model-reviewer, K4/K5) pour que les deux ne puissent
// plus diverger silencieusement.
//
// `status: { in: [...] }` et non `{ not: "voided" }` : c'est ce qui rend la
// garde hermétique quand un règlement tombe ENTRE la lecture et le commit —
// l'updateMany ne trouve alors plus aucune ligne et la cession est avortée.
export function financeableInvoiceWhere(invoiceId: string) {
  return {
    id: invoiceId,
    financedByPartnerId: null,
    validatedByAdministration: true,
    status: { in: [...STATUTS_FINANCABLES] },
    disputeStatus: { not: "disputed" as const },
    customer: {
      isPublicEntityConfirmed: true,
      publicBuyerAccount: { verificationStatus: "verified" as const },
    },
  };
}
