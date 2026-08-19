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
