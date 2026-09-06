-- ═══════════════════════════════════════════════════════════════════════════════
--  Activation du Row-Level Security sur Supabase (hébergement intérimaire, ADR-120)
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  NE PAS lancer via `prisma migrate` — ce script vit hors du dossier migrations/
--  exprès. Il s'exécute À LA MAIN, dans l'éditeur SQL Supabase (Dashboard →
--  SQL Editor), en tant que rôle `postgres`, APRÈS `prisma migrate deploy` (qui
--  pose les deux migrations RLS : 20260829150000_enable_row_level_security et
--  20260905120000_rls_practice_scope, toutes deux DORMANTES).
--
--  Il transcrit les étapes 2, 4 et 5 de docs/runbooks/rls-rollout.md — LIRE LE
--  RUNBOOK D'ABORD. Exécuter SECTION 1, puis basculer `DATABASE_URL` des apps
--  (`fly secrets set`, trust-api ET money-api, via le pooler 6543 `?pgbouncer=true`),
--  redéployer, valider (checklist étape 3). SECTION 2 seulement quand tous les
--  accès tenant passent par `organizationScopedClient` / `practiceScopedClient`.
--
--  Contexte Supabase : `postgres` contourne RLS comme un propriétaire. Les rôles
--  `anon` / `authenticated` / `service_role` / `authenticator` ne sont pas
--  utilisés (ni PostgREST, ni GoTrue — l'IAM est dans trust-api). Aucune policy
--  `auth.uid()` : uniquement `org_isolation` par GUC de session.
--
--  Idempotent (IF NOT EXISTS / IF EXISTS). `professional_practice` et
--  `practice_member` n'ont volontairement pas de RLS (ADR-111 phase 2).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 1 — Rôle applicatif NON-propriétaire (étape 2 du runbook)          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

DO $section1$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') THEN
    -- Mot de passe : le générer, le stocker dans Fly secrets, et remplacer le
    -- placeholder ci-dessous AVANT d'exécuter.
    CREATE ROLE facture_app LOGIN PASSWORD 'CHANGE_ME_avant_execution'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$section1$;

GRANT USAGE ON SCHEMA public TO facture_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO facture_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO facture_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO facture_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO facture_app;
GRANT EXECUTE ON FUNCTION public.rls_practice_sees_org(text) TO facture_app;

-- → Basculer DATABASE_URL sur facture_app, valider (runbook étape 3), PUIS SECTION 2.


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 2 — FORCE ROW LEVEL SECURITY (étape 4 + 5 du runbook)              ║
-- ║ Retirer le bloc /* */ ci-dessous pour l'exécuter.                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

/*
DO $section2$
DECLARE
  rls_tables text[] := ARRAY[
    'account_recovery_request','api_key','assisted_session','bank_transaction',
    'branch','commission_bypass_case','credit_limit_change_request','customer',
    'fiscal_period_closing','invoice','invoice_sequence','mandate',
    'organization','organization_member','organization_signing_key',
    'pending_member_invite','product','recurring_invoice_template',
    'revenue_share_credit','ussd_session',
    'payment','invoice_line','credit_note','invoice_event','refund',
    'payment_provider_attempt','credit_note_line','product_stock'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY rls_tables LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  RAISE NOTICE 'RLS forcé sur % tables.', array_length(rls_tables, 1);
END
$section2$;

-- Défense en profondeur J1 — invoice_event append-only : facture_app garde
-- SELECT + INSERT uniquement.
REVOKE UPDATE, DELETE, TRUNCATE ON public.invoice_event FROM facture_app;

-- customer (anonymisation J2) et bank_transaction (rapprochement) : l'UPDATE est
-- légitime → on ne révoque QUE le TRUNCATE (cf. runbook étape 5).
REVOKE TRUNCATE ON public.customer, public.bank_transaction FROM facture_app;
*/


-- ── Vérifications (à lancer séparément) ─────────────────────────────────────
--   SELECT tablename FROM pg_policies WHERE policyname = 'org_isolation' ORDER BY 1;   -- 28
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'rls_practice_sees_org';
--   SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = ANY (ARRAY['invoice','invoice_event','customer','mandate']) ORDER BY 1;
--   -- Rappel PG15+ (Supabase) : REVOKE CREATE ON SCHEMA public FROM PUBLIC en vigueur (défaut).
