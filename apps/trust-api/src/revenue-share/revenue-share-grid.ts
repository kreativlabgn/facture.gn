// H4, ADR-071 — 10% (paramètre config `revenue_share_rate_bps`), plafond 5000
// GNF/mois/client (`revenue_share_cap_per_client_gnf`, Grille-Offres §5.2).
// Constante hardcodée, pas de CONFIG_PARAMETER (ADR-058 jamais scaffoldée dans
// ce repo — même choix déjà accepté que commission-grid.ts/ADR-074).
export const REVENUE_SHARE_RATE_BPS = 1000;
export const REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF = 500_000n;
