-- Étape 2 du runbook RLS (docs/runbooks/rls-rollout.md) — armement du rôle
-- applicatif NON PROPRIÉTAIRE.
--
-- POURQUOI CE RÔLE. Les politiques `org_isolation` posées par
-- 20260829150000 / 20260905120000 sont ENABLE mais pas FORCE, et le
-- propriétaire des tables contourne nativement RLS. Tant que l'application se
-- connecte en `postgres`, les politiques ne mordent donc jamais. `facture_app`
-- est le rôle qui les rend effectives : NOBYPASSRLS, non propriétaire, sans
-- SUPERUSER.
--
-- IDEMPOTENT : rejouable sans effet de bord. À exécuter avec le rôle
-- propriétaire, jamais avec facture_app lui-même.
--
-- Les MIGRATIONS continuent de tourner avec le propriétaire : seule la
-- DATABASE_URL applicative bascule (DIRECT_URL reste sur le propriétaire).

\set ON_ERROR_STOP on

-- ── 1. Le rôle ───────────────────────────────────────────────────────────────
-- Mot de passe passé par `-v mdp=...` ; jamais en dur dans un fichier versionné.
--
-- Conditionnelle psql (\if) et NON un bloc DO $$ : psql n'interpole PAS ses
-- variables à l'intérieur d'une chaîne dollar-quotée — `:'mdp'` y serait pris
-- au pied de la lettre et produirait une erreur de syntaxe.
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') AS doit_creer \gset

\if :doit_creer
CREATE ROLE facture_app LOGIN PASSWORD :'mdp';
\echo '  → rôle facture_app créé'
\else
ALTER ROLE facture_app LOGIN PASSWORD :'mdp';
\echo '  → rôle facture_app déjà présent, mot de passe réaligné'
\endif

-- Explicite, même si c'est le défaut : c'est LA propriété dont dépend toute
-- l'étape 2. La poser noir sur blanc évite qu'un ALTER ROLE ultérieur la perde
-- en silence.
ALTER ROLE facture_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- ── 2. Les droits ────────────────────────────────────────────────────────────
GRANT CONNECT ON DATABASE facture_gn_dev TO facture_app;
GRANT USAGE ON SCHEMA public TO facture_app;

-- `rls_practice_sees_org` est SECURITY INVOKER et est appelée DANS le prédicat
-- des politiques : sans ce GRANT, toute requête d'un cabinet échouerait sur un
-- « permission denied for function » — pas sur un résultat vide.
GRANT EXECUTE ON FUNCTION public.rls_practice_sees_org(text) TO facture_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO facture_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO facture_app;

-- Les tables créées par les MIGRATIONS FUTURES (jouées par le propriétaire)
-- doivent être accessibles sans repasser ce script.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO facture_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO facture_app;

-- ── 3. Ce qu'on ne donne PAS, et pourquoi ────────────────────────────────────
-- • Aucun BYPASSRLS / SUPERUSER : ce serait annuler l'objet du rôle.
-- • Aucune propriété de table : le propriétaire contourne RLS même sans
--   BYPASSRLS tant que FORCE n'est pas posé (étape 4).
-- • Aucun GRANT sur les GUC `app.current_org_id` / `app.current_practice_id` :
--   PostgreSQL n'a PAS de privilèges sur les paramètres personnalisés à préfixe.
--   Tout rôle peut les poser via set_config() et les lire via current_setting().
--   Il n'y a donc rien à accorder — la vérification #3 du brief est sans objet,
--   et le contrôle ci-dessous le démontre plutôt que de le supposer.

-- ── 4. Contrôles ─────────────────────────────────────────────────────────────
SELECT rolname, rolbypassrls, rolsuper, rolcanlogin
FROM pg_roles WHERE rolname = 'facture_app';

SELECT count(*) FILTER (WHERE has_table_privilege('facture_app', c.oid, 'SELECT')) AS tables_lisibles,
       count(*)                                                                   AS tables_publiques
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

SELECT has_function_privilege('facture_app', 'public.rls_practice_sees_org(text)', 'EXECUTE')
       AS peut_evaluer_le_predicat_cabinet;
