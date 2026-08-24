-- Fix minor-followups 2026-08-24 — pending_member_invite.organization_id/
-- practice_id sont des FK optionnelles (mutuellement exclusives, cf.
-- pending_member_invite_xor_target_check de 20260823160000) mais avaient été
-- créées en ON DELETE RESTRICT (20260823150000), copié à tort du pattern des
-- FK organizationId/practiceId REQUISES d'AssistedSession/Mandate/
-- PracticeMember/OrganizationMember (les seules où RESTRICT est correct dans
-- ce schema). Le reste du schema aligne systématiquement toute FK optionnelle
-- sur ON DELETE SET NULL (Customer.possibleDuplicateOf, Mandate.grantedBy,
-- CreditLimitChangeRequest.resolvedByUserId, AccountRecoveryRequest.
-- resolvedByUserId, Invoice.customerId/branchId...). Aucune fonctionnalité de
-- suppression d'organisation/cabinet n'existe aujourd'hui (impact pratique
-- nul), mais RESTRICT bloquerait à tort cette suppression future à cause
-- d'une invitation même déjà résolue/expirée/révoquée et jamais purgée.
--
-- CORRECTIF, revue post-fix #1 (20260824110000) — ce SetNull seul NE suffisait
-- PAS : la contrainte pending_member_invite_xor_target_check (20260823160000)
-- imposait alors EXACTEMENT un des deux champs non-nul, donc un SET NULL
-- produisant (NULL, NULL) violait les deux branches du CHECK et faisait
-- échouer TOUTE suppression d'organisation/cabinet ayant une invitation liée
-- — exactement le blocage que ce fix prétendait lever, avec un message
-- d'erreur CHECK plus déroutant que le FK RESTRICT explicite d'avant. Le
-- correctif complet a trois volets : (1) ce SetNull ici, (2) le CHECK
-- assoupli en "jamais les deux à la fois" par 20260824110000, (3) la gestion
-- applicative explicite du cas (null, null) dans
-- PendingMemberInviteService.resolveForNewUser() (l'invitation est marquée
-- acceptée mais ne peut plus résoudre à aucun membership, sa cible ayant
-- disparu — voir commentaire dans le service).
ALTER TABLE "pending_member_invite" DROP CONSTRAINT "pending_member_invite_organization_id_fkey";
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pending_member_invite" DROP CONSTRAINT "pending_member_invite_practice_id_fkey";
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "professional_practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
