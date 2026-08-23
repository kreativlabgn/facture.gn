-- F10, revue post-fix #1 — au plus une invitation VIVANTE (ni acceptée ni
-- révoquée) par numéro et par cible, garanti au niveau base plutôt que par le
-- seul findFirst+create applicatif de PendingMemberInviteService (fenêtre de
-- course réelle : deux invitations concurrentes sur le même (msisdn,
-- organizationId) pouvaient toutes deux passer le check, puis faire échouer
-- toute la transaction AuthService.register() au moment de la résolution,
-- via une violation P2002 sur organization_member/practice_member non
-- catchée). Une ré-invitation après résolution/révocation reste possible
-- (WHERE exclut ces lignes) — même précédent que
-- payment_one_arrhes_per_invoice (20260809140000).
CREATE UNIQUE INDEX "pending_member_invite_one_live_per_org"
ON "pending_member_invite" ("msisdn", "organization_id")
WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL AND "organization_id" IS NOT NULL;

CREATE UNIQUE INDEX "pending_member_invite_one_live_per_practice"
ON "pending_member_invite" ("msisdn", "practice_id")
WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL AND "practice_id" IS NOT NULL;

-- F10, revue post-fix #2 — organization_id/practice_id mutuellement exclusifs,
-- garanti au niveau base plutôt que par la seule convention applicative (les
-- deux méthodes de service actuelles respectent déjà l'exclusivité, mais rien
-- ne protégeait contre un futur script d'admin ou un troisième point d'écriture
-- qui la violerait) — même précédent que invoice_conversion_requires_proforma_check
-- (20260809130000).
ALTER TABLE "pending_member_invite"
ADD CONSTRAINT "pending_member_invite_xor_target_check"
CHECK (
  ("organization_id" IS NOT NULL AND "practice_id" IS NULL)
  OR ("organization_id" IS NULL AND "practice_id" IS NOT NULL)
);
