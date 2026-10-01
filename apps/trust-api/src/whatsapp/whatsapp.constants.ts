// Plan 2026-09-16 (OCR multicanal), étape 2 — constantes du webhook WhatsApp
// entrant (Meta Cloud API, clarification 6 du plan). Réutilisées par le
// connecteur SORTANT (notifications/sovereign-whatsapp-send.provider.ts) pour
// le chemin Graph API, et par le futur relais média (Étape 3,
// whatsapp-media-relay.service.ts, non construit ici).

/** En-tête de signature HMAC-SHA256 du corps brut, format `sha256=<hex>`
 *  (whatsapp-webhook-auth.guard.ts). */
export const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";

/** Base de l'API Graph Meta — envoi de message (Cloud API v20). Le futur
 *  relais média (Étape 3) suffixera `/{media-id}` sur la même base. */
export const WHATSAPP_GRAPH_API_BASE_URL = "https://graph.facebook.com/v20.0";

/** Plafond arbitraire mais documenté (clarification 6, point 7 du plan) —
 *  même ordre de grandeur que les 20/60 s de POST /ai/ocr/scans, à recalibrer
 *  sur l'usage réel après le pilote. Compteur PAR ORGANISATION résolue,
 *  jamais par IP (tout le trafic Meta Cloud API partage un pool d'IP
 *  plateforme, voir whatsapp-abuse-guard.service.ts). */
export const WHATSAPP_OCR_HOURLY_LIMIT = 30;
