// Lot J3 — compteur de lignes purgées par la rétention, par table.
// Préfixe par service (trust_api_) : évite une collision dans le registre
// prom-client global si trust-api et money-api sont chargés dans un même
// process (tests). Même convention que HTTP_DURATION_METRIC (Lot F).
export const RETENTION_DELETED_METRIC = "trust_api_retention_rows_deleted_total";
