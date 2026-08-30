-- Lot J3 — index sur les prédicats de purge de RetentionService
-- (apps/trust-api/src/retention). Sans eux, chaque `deleteMany` quotidien fait
-- un seq scan complet ; sur `ussd_session` et `revoked_token` (fort churn,
-- canal d'inclusion USSD) le verrou de suppression pèserait sur le chemin
-- d'authentification (SLA émission USSD < 90 s).
--
-- CREATE INDEX simple (pas CONCURRENTLY : la 1re application est sur des tables
-- vides / petites ; prisma migrate deploy tourne dans une transaction).

CREATE INDEX "ussd_session_expires_at_idx" ON "ussd_session"("expires_at");
CREATE INDEX "client_portal_otp_expires_at_idx" ON "client_portal_otp"("expires_at");
CREATE INDEX "revoked_token_expires_at_idx" ON "revoked_token"("expires_at");
CREATE INDEX "pending_member_invite_accepted_at_expires_at_idx" ON "pending_member_invite"("accepted_at", "expires_at");
