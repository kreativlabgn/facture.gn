// F13, revue post-fix #6 — constante de domaine partagée, déplacée depuis
// customers.service.ts (CustomersModule ne l'exportait pas ; ClientPortalService
// l'importait en contournant la frontière de module déclarée, couplage fragile
// qui aurait cassé silencieusement au moindre refactor de customers.service.ts).
// Même définition de "solde dû"/"facture outstanding" pour CustomersService et
// ClientPortalService — jamais une seconde source de vérité.
export const OUTSTANDING_INVOICE_STATUSES = ["issued", "partially_paid"] as const;
