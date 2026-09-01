// Lot rapprochement bancaire (ADR-052, ADR-117 provisoire).

// Fenêtre entre l'émission de la facture et la date de valeur du virement au-delà
// de laquelle la seule proximité de date ne vaut plus un signal. 30 jours = choix
// MVP documenté ici (même posture que les seuils de cash-anomaly-detection.ts) ;
// le rapprochement final reste toujours une confirmation humaine, jamais un rejet.
export const MATCH_DATE_WINDOW_DAYS = 30;

// Garde-fou sur la taille d'un import : la PWA pousse un relevé, pas un historique
// entier. Un dépassement est rejeté par le DTO (l'appelant scinde).
export const MAX_IMPORT_BATCH_SIZE = 500;

// Plafond de suggestions renvoyées par transaction : au-delà, la liste n'aide
// plus le staff à trancher (trop de factures au même montant → affiner le relevé).
export const MAX_SUGGESTIONS_PER_TX = 10;
