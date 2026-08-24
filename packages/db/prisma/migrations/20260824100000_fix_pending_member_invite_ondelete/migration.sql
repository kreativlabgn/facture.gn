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
ALTER TABLE "pending_member_invite" DROP CONSTRAINT "pending_member_invite_organization_id_fkey";
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pending_member_invite" DROP CONSTRAINT "pending_member_invite_practice_id_fkey";
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "professional_practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
