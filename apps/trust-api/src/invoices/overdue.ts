// I2 — aucune notion d'"échéance"/dueDate dans le schéma ni l'ERD/ADR : seul
// point d'ancrage documentaire trouvé, Grille-Offres-facture-gn.md §3.1
// (analytics Freemium/Starter) qui liste déjà "factures en retard > 30 jours"
// comme concept produit, jamais implémenté ailleurs. Constante nommée plutôt
// qu'un champ configurable par organisation — même précédent que
// DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD (E5), pas de CONFIG_PARAMETER
// générique (ADR-058 jamais scaffoldée).
export const OVERDUE_THRESHOLD_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const OVERDUE_ELIGIBLE_STATUSES = ["issued", "partially_paid"] as const;

export function isOverdue(invoice: { status: string; issuedAt: Date | null }): boolean {
  if (!invoice.issuedAt) {
    return false;
  }
  if (!(OVERDUE_ELIGIBLE_STATUSES as readonly string[]).includes(invoice.status)) {
    return false;
  }
  const daysSinceIssued = (Date.now() - invoice.issuedAt.getTime()) / ONE_DAY_MS;
  return daysSinceIssued > OVERDUE_THRESHOLD_DAYS;
}
