// E5, ADR-083 — seuil de repli quand Organization.creditLimitApprovalThreshold
// n'est pas défini. Aucune valeur n'est spécifiée par le Backlog/ADR-083/ADR-058 ;
// constante ajustable en un point unique, jamais gravée dans une migration de
// données. Même choix déjà accepté que commission-grid.ts (ADR-074) et
// tax-regime.ts (C4) : pas de CONFIG_PARAMETER générique pour ce seul besoin.
export const DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD = 10_000_000n;
