-- RLS des tables B2G — b2g_case, telemo_award, ocaecg_license (ADR-111 / ADR-126).
--
-- Migration ÉCRITE À LA MAIN (aucun DDL : pas de changement de schéma Prisma,
-- `prisma migrate diff` migrations ↔ schema.prisma reste vide).
--
-- ── POURQUOI ─────────────────────────────────────────────────────────────────
-- 20260917100000_add_public_command_telemo_b2g_ocaecg a créé ces trois tables
-- sans les enrôler dans le registre RLS. L'application tourne (cible, runbook
-- étape 3) en facture_app (NOBYPASSRLS) : une table sans politique y reste
-- intégralement lisible par TOUTE organisation. b2g_case relie une facture à un
-- marché public et à son fournisseur ; telemo_award porte le NIF fournisseur et
-- le montant d'attribution ; ocaecg_license porte l'agrément d'un cabinet.
--
-- Même règle, mêmes mots que 20260911120000_ocr_document : « sans politique,
-- elle serait le seul trou du registre RLS ».
--
-- ── CE QUE CETTE MIGRATION NE CHANGE PAS ─────────────────────────────────────
-- Le prédicat est DORMANT tant qu'aucun GUC n'est posé (runbook rls-rollout,
-- vue d'ensemble) : `nullif(current_setting(...), '')` — pas
-- `current_setting(...) IS NULL`, voir 20260907010000_rls_dormancy_empty_string.
-- Aucun comportement de production ne change aujourd'hui. Seul appelant
-- existant : PublicBuyerPortalService.registerObjection, qui pose
-- setOrganizationScope(tx, invoice.organizationId) AVANT d'accéder à b2g_case.
-- telemo_award et ocaecg_license n'ont aucun consommateur.
--
-- ── b2g_case, telemo_award : organization_id ─────────────────────────────────
-- Prédicat uniforme du registre : organisation courante, OU cabinet mandaté
-- (rls_practice_sees_org, créée par 20260905120000_rls_practice_scope).
-- telemo_award.organization_id est NULLABLE (attribution Telemo pas encore
-- rattachée à un fournisseur) : une telle ligne n'est visible d'AUCUN scope
-- d'organisation, seulement d'une session non scopée.
--
-- ── ocaecg_license : cabinet_id ──────────────────────────────────────────────
-- La clé est cabinet_id (→ organization), pas organization_id : un agrément
-- appartient au cabinet. Pas d'échappement rls_practice_sees_org : un cabinet
-- n'est pas mandaté sur lui-même, l'ajouter n'aurait aucun sens. Sémantique
-- (donnée de tenant ou registre de référence) à confirmer avec le produit
-- (plan 2026-10-01-rls-tables-b2g, Clarifications) : aucun consommateur
-- aujourd'hui, réversible par une migration d'une ligne.
--
-- FORCE est posé dans la foulée, comme pour ocr_document.

-- ── b2g_case ─────────────────────────────────────────────────────────────────
ALTER TABLE "b2g_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "b2g_case" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "b2g_case";
CREATE POLICY org_isolation ON "b2g_case" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(organization_id)
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(organization_id)
  );

-- ── telemo_award ─────────────────────────────────────────────────────────────
ALTER TABLE "telemo_award" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telemo_award" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "telemo_award";
CREATE POLICY org_isolation ON "telemo_award" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(organization_id)
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(organization_id)
  );

-- ── ocaecg_license (clé : cabinet_id) ────────────────────────────────────────
ALTER TABLE "ocaecg_license" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ocaecg_license" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "ocaecg_license";
CREATE POLICY org_isolation ON "ocaecg_license" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR cabinet_id = nullif(current_setting('app.current_org_id', true), '')
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR cabinet_id = nullif(current_setting('app.current_org_id', true), '')
  );

-- Le rôle applicatif : ALTER DEFAULT PRIVILEGES (script d'armement) couvre les
-- tables créées ensuite, mais on l'explicite ici pour que cette migration soit
-- autonome — rejouable sur une base où le rôle existe déjà.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "b2g_case", "telemo_award", "ocaecg_license" TO facture_app;
  END IF;
END
$do$;
