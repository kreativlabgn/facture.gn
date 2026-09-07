-- Étape 4 du runbook RLS (docs/runbooks/rls-rollout.md) — FORCE ROW LEVEL SECURITY.
--
-- ── CE QUE FORCE CHANGE, ET CE QU'IL NE CHANGE PAS ───────────────────────────
-- `ENABLE ROW LEVEL SECURITY` (posé par 20260829150000) applique les politiques
-- à tous les rôles SAUF le propriétaire de la table. `FORCE` les lui applique
-- aussi.
--
-- Conséquence pour l'application : AUCUNE. Depuis l'étape 3 elle se connecte en
-- `facture_app`, qui n'est pas propriétaire — les politiques la contraignaient
-- déjà pleinement. FORCE est ici une défense en profondeur : il ferme le cas où
-- un service se reconnecterait par erreur avec le rôle propriétaire.
--
-- ⚠ LIMITE À CONNAÎTRE. Un rôle SUPERUSER contourne RLS quoi qu'il arrive :
-- FORCE ne s'applique qu'à un propriétaire NON superuser. Sur l'environnement de
-- développement local, le propriétaire est `postgres` (superuser) — cette
-- migration y est donc un no-op observable, vérifié le 2026-09-07. Elle prend
-- son sens en staging/production, où le propriétaire du schéma n'est pas
-- superuser (cas usuel des Postgres managés).
--
-- PRÉCONDITION, satisfaite : l'étape 1 est close (les 31 modules de trust-api
-- sont traités, commit 893d5a9) et le correctif de dormance
-- 20260907010000_rls_dormancy_empty_string est appliqué. Sans ce dernier, FORCE
-- transformerait chaque lecture non scopée du propriétaire en résultat vide.
--
-- Idempotent : rejouable sans effet de bord.

-- ── Les 28 tables du registre RLS ────────────────────────────────────────────
-- Liste explicite (et non dérivée du catalogue) pour rester auditable en revue :
-- ce fichier dit exactement quelles tables sont concernées. Le contrôle final
-- ci-dessous vérifie qu'aucune table sous RLS n'a été oubliée.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_recovery_request','api_key','assisted_session','bank_transaction',
    'branch','commission_bypass_case','credit_limit_change_request','customer',
    'fiscal_period_closing','invoice','invoice_sequence','mandate',
    'organization_member','organization_signing_key','product',
    'recurring_invoice_template','revenue_share_credit','ussd_session',
    'pending_member_invite','organization','payment','invoice_line',
    'credit_note','invoice_event','refund','payment_provider_attempt',
    'credit_note_line','product_stock'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$do$;

-- ── Contrôle : aucune table sous RLS laissée sans FORCE ──────────────────────
-- Échoue la migration plutôt que de laisser un trou silencieux si une table a
-- reçu ENABLE sans être ajoutée à la liste ci-dessus.
DO $do$
DECLARE oubliees text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO oubliees
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relrowsecurity AND NOT c.relforcerowsecurity;

  IF oubliees IS NOT NULL THEN
    RAISE EXCEPTION 'Tables sous RLS sans FORCE : % — les ajouter à la liste de cette migration', oubliees;
  END IF;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback : `ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;` sur les mêmes tables.
-- Ne rend l'accès qu'au PROPRIÉTAIRE — l'application, en `facture_app`, reste
-- contrainte par les politiques dans tous les cas.
