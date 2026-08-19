// K4, ADR-031 — "règle composite unique is_financeable(), toute modification
// est un ADR". Composite retenu (voir PLAN "Clarifications") : le seul
// composant explicitement documenté par ADR-080 (validatedByAdministration)
// + l'anti-double-financement (K5, ADR-089) + une garde de bon sens (jamais
// une facture annulée). Fonction unique, jamais dupliquée ailleurs.
export function isFinanceable(invoice: {
  validatedByAdministration: boolean;
  financedByPartnerId: string | null;
  status: string;
}): boolean {
  return invoice.validatedByAdministration && invoice.financedByPartnerId === null && invoice.status !== "voided";
}

// Reproduit les 3 conditions de isFinanceable() sous forme de clause Prisma
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
  };
}
