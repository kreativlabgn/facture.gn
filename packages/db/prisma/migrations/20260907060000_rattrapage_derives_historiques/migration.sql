-- Rattrapage des dérives historiques du schéma.
--
-- Ces deux écarts entre schema.prisma et la base remontaient à chaque
-- `migrate diff` depuis le chantier 2. Ils ont été systématiquement ÉCARTÉS des
-- migrations de ces chantiers (device_enrollment, apip_etax_unique_identifiers,
-- etax_submission_tracking) pour ne pas les faire passer en revue en
-- contrebande d'un travail sans rapport. Ils sont traités ici, seuls et
-- explicitement.
--
-- ⚠ CETTE MIGRATION MODIFIE RÉELLEMENT LA BASE. Ce n'est pas un simple marqueur
-- de registre : la base ne portait PAS l'état décrit par le schéma — c'est
-- précisément la raison pour laquelle le différentiel n'était pas vide.
--
-- ── DÉRIVE 1 — pending_member_invite_resolved_user_id_fkey ──────────────────
-- Constaté en base : ON DELETE RESTRICT.
-- Voulu par le schéma : ON DELETE SET NULL — `resolvedUser User?` est une
-- relation OPTIONNELLE, dont l'action référentielle par défaut chez Prisma est
-- SET NULL. La contrainte date d'avant que le champ devienne optionnel.
--
-- CONSÉQUENCE FONCTIONNELLE, à connaître : sous RESTRICT, supprimer un `user`
-- ayant résolu une invitation était BLOQUÉ par la base. Sous SET NULL la
-- suppression passe et la référence est mise à NULL. C'est le comportement
-- voulu — l'invitation garde sa trace historique sans épingler l'utilisateur —
-- et c'est ce dont a besoin le chemin d'anonymisation des droits des personnes
-- (J2, ADR-116). Aucune donnée n'est perdue par cette migration elle-même.
--
-- ── DÉRIVE 2 — index unique de revenue_share_credit ─────────────────────────
-- Simple renommage. Le nom en base a été tronqué à la limite d'identifiant de
-- Postgres (63 caractères) au moment de sa création ; Prisma attend le nom
-- complet. Aucune reconstruction d'index : ALTER INDEX ... RENAME est une
-- opération de catalogue, instantanée, qui ne relit aucune ligne.
--
-- Aucune section RLS : aucune table créée, aucune colonne ajoutée, aucun
-- privilège touché.

-- DropForeignKey
ALTER TABLE "pending_member_invite" DROP CONSTRAINT "pending_member_invite_resolved_user_id_fkey";

-- AddForeignKey
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_resolved_user_id_fkey" FOREIGN KEY ("resolved_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "revenue_share_credit_practice_id_organization_id_period_mo_key" RENAME TO "revenue_share_credit_practice_id_organization_id_period_mon_key";
