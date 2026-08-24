-- Fix minor-followups 2026-08-24, revue post-fix #1 — corrige un bug introduit
-- par 20260824100000 : cette migration avait basculé organization_id/practice_id
-- de RESTRICT vers ON DELETE SET NULL, mais avait laissé intacte la contrainte
-- pending_member_invite_xor_target_check (20260823160000) qui impose EXACTEMENT
-- un des deux champs non-nul. Dès qu'une organisation ou un cabinet cible d'une
-- invitation (même résolue/expirée/révoquée) était supprimé, le SET NULL
-- produisait une ligne (organization_id: NULL, practice_id: NULL) qui viole les
-- DEUX branches du CHECK XOR — la suppression échouait donc TOUJOURS, avec un
-- message "CHECK constraint" plus déroutant à la place du FK RESTRICT explicite
-- d'avant. SetNull seul ne suffisait pas : il fallait aussi assouplir le CHECK.
--
-- Nouvel invariant : "jamais les deux cibles à la fois" (au lieu de "exactement
-- une des deux") — (NULL, NULL) devient un état terminal légitime, atteint
-- uniquement quand la cible d'une invitation a été supprimée après coup.
-- PendingMemberInviteService.resolveForNewUser() gère explicitement ce cas
-- (apps/trust-api/src/pending-member-invites/pending-member-invite.service.ts).
ALTER TABLE "pending_member_invite" DROP CONSTRAINT "pending_member_invite_xor_target_check";

ALTER TABLE "pending_member_invite"
ADD CONSTRAINT "pending_member_invite_xor_target_check"
CHECK (
  NOT ("organization_id" IS NOT NULL AND "practice_id" IS NOT NULL)
);
