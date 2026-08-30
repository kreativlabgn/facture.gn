// Lot J3 — purge des tables opérationnelles éphémères.
//
// Aucune spec (ADR, Backlog, DAT) ne fixe de durée de conservation pour ces
// tables — comme ASSISTED_SESSION_TTL_MS et PENDING_MEMBER_INVITE_TTL_MS qui
// définissent, eux, l'EXPIRATION. Ici on ajoute un DÉLAI DE GRÂCE après
// expiration avant suppression physique (marge de debug / support). Ajustable
// uniquement ici.
//
// `invoice_event` n'est JAMAIS purgé (WORM, ADR-015 — garde append-only J1).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Fréquence du job de purge. La rétention n'est pas urgente : une fois par jour. */
export const RETENTION_INTERVAL_MS = DAY_MS;

/** ussd_session : expiresAt court (< 90 s). 24 h de marge pour tracer un incident. */
export const USSD_SESSION_GRACE_MS = DAY_MS;

/** client_portal_otp : OTP consommé ou expiré. 7 j de marge (support client). */
export const CLIENT_PORTAL_OTP_GRACE_MS = 7 * DAY_MS;

/** revoked_token : liste de révocation d'access tokens (TTL 12 h). Sans objet une
 *  fois le token sous-jacent expiré ; 24 h de marge. */
export const REVOKED_TOKEN_GRACE_MS = DAY_MS;

/** pending_member_invite : invitation NON acceptée et expirée depuis 30 j. Une
 *  invitation acceptée n'est jamais purgée (resolvedUserId = trace utile). */
export const PENDING_MEMBER_INVITE_GRACE_MS = 30 * DAY_MS;

/** assisted_session : purge UNIQUEMENT si révoquée (mission explicitement
 *  terminée) depuis 90 j. Jamais sur la seule expiration — consentRecordedAt est
 *  une preuve de consentement (L/2016/037) pour des factures conservées 10 ans.
 *  Voir le PLAN, contraintes léguées à J2. */
export const ASSISTED_SESSION_REVOKED_GRACE_MS = 90 * DAY_MS;
