// Lot E1 — registre Merkle des factures. Réglages ajustables en un point.

const HOUR_MS = 3_600_000;

/** Scellement d'une tranche : toutes les heures (le job scelle l'heure close). */
export const SEAL_INTERVAL_MS = HOUR_MS;

/** Flush vers le seam d'ancrage : plus fréquent (un sink peut mettre du temps). */
export const FLUSH_INTERVAL_MS = 30 * 60_000;

/** Nombre de tranches `pending` traitées par passage de flush. */
export const FLUSH_BATCH_LIMIT = 20;

/** Plafond de feuilles par tranche. Borne la mémoire du job de scellement ET la
 *  reconstruction de preuve sur /verify (public). Un backlog (long downtime) se
 *  résorbe sur plusieurs runs successifs. ~1400/h en régime établi. */
export const MAX_LEAVES_PER_BATCH = 20_000;

/** `previousRoot` de la toute première tranche. */
export const GENESIS_ROOT = "GENESIS";

/** Opt-in explicite (comme la rétention J3) — aucun job sans ça. */
export function merkleAnchorEnabled(): boolean {
  return (process.env.MERKLE_ANCHOR_ENABLED ?? "").trim().toLowerCase() === "true";
}
