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
export function isFinanceable(invoice: {
  validatedByAdministration: boolean;
  financedByPartnerId: string | null;
  status: string;
  publicBuyerAccountVerified: boolean;
}): boolean {
  return (
    invoice.validatedByAdministration &&
    invoice.financedByPartnerId === null &&
    invoice.status !== "voided" &&
    invoice.publicBuyerAccountVerified
  );
}

// Reproduit les 4 conditions de isFinanceable() sous forme de clause Prisma
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
    customer: { publicBuyerAccount: { verificationStatus: "verified" as const } },
  };
}
