// Lot E1 — métriques du registre Merkle. Préfixe par service (trust_api_) :
// évite une collision dans le registre prom-client global si money-api est
// co-résident en test. Même convention que HTTP_DURATION_METRIC (Lot F).

/** Cumul des tranches scellées. */
export const MERKLE_BATCHES_SEALED_METRIC = "trust_api_merkle_batches_sealed_total";

/** Cumul des factures rattachées à une tranche. */
export const MERKLE_INVOICES_ANCHORED_METRIC = "trust_api_merkle_invoices_anchored_total";

/** Cumul des échecs d'appel au seam d'ancrage (par nom de sink). */
export const MERKLE_FLUSH_ERRORS_METRIC = "trust_api_merkle_flush_errors_total";

/** Nombre de tranches encore `pending` (jauge). Alerter si ça croît sans fin. */
export const MERKLE_PENDING_BATCHES_METRIC = "trust_api_merkle_pending_batches";

/** 1 si les schedulers Merkle sont armés, 0 sinon (jauge). */
export const MERKLE_SCHEDULERS_ARMED_METRIC = "trust_api_merkle_schedulers_armed";
