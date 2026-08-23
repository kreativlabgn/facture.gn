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
export function isFinanceable(invoice: {
  validatedByAdministration: boolean;
  financedByPartnerId: string | null;
  status: string;
  publicBuyerAccountVerified: boolean;
  publicEntityConfirmed: boolean;
}): boolean {
  return (
    invoice.validatedByAdministration &&
    invoice.financedByPartnerId === null &&
    invoice.status !== "voided" &&
    invoice.publicBuyerAccountVerified &&
    invoice.publicEntityConfirmed
  );
}

// Reproduit les 5 conditions de isFinanceable() sous forme de clause Prisma
// `where` — c'est cette clause, pas isFinanceable(), qui protège réellement
// contre la concurrence au moment du commit (voir chooseFinancing()). Extrait
// ici (revue dev-domain-model-reviewer, K4/K5) pour que les deux ne puissent
// plus diverger silencieusement.
export function financeableInvoiceWhere(invoiceId: string) {
  return {
    id: invoiceId,
    financedByPartnerId: null,
    validatedByAdministration: true,
    status: { not: "voided" as const },
    customer: {
      isPublicEntityConfirmed: true,
      publicBuyerAccount: { verificationStatus: "verified" as const },
    },
  };
}
