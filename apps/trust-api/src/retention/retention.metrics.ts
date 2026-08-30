// Lot J3 — métriques de la rétention. Préfixe par service (trust_api_) : évite
// une collision dans le registre prom-client global si trust-api et money-api
// sont chargés dans un même process (tests). Même convention que
// HTTP_DURATION_METRIC (Lot F).

/** Cumul des lignes supprimées par la rétention, par table. */
export const RETENTION_DELETED_METRIC = "trust_api_retention_rows_deleted_total";

/** Cumul des échecs de purge, par table (le pendant de RETENTION_DELETED_METRIC).
 *  Une valeur qui croît = l'alerte du runbook. */
export const RETENTION_ERRORS_METRIC = "trust_api_retention_errors_total";

/** État du scheduler : 1 = job de purge armé, 0 = non armé (Redis KO au boot,
 *  ou RETENTION_ENABLED absent/≠ "true"). Permet d'alerter sur « purge jamais
 *  planifiée » sans dépendre du log-scraping. */
export const RETENTION_SCHEDULER_ARMED_METRIC = "trust_api_retention_scheduler_armed";
