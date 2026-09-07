-- Correctif de DORMANCE (ADR-111, étape 2 du runbook docs/runbooks/rls-rollout.md).
--
-- ── LE DÉFAUT CORRIGÉ ICI ────────────────────────────────────────────────────
-- `set_config('app.current_org_id', <id>, TRUE)` est LOCAL à la transaction.
-- Mais en fin de transaction PostgreSQL ne restaure pas NULL : il restaure la
-- CHAÎNE VIDE. Une fois qu'un paramètre personnalisé a été touché dans une
-- session, `current_setting(..., true)` y rend '' et plus jamais NULL.
--
-- Conséquence sur le prédicat de 20260905120000, qui testait `IS NULL` :
--   • la branche dormante devient FAUSSE dès la 1re requête scopée ;
--   • `organization_id = NULL` → NULL (pas vrai) ;
--   • `practice_id = ''`      → faux.
-- ⇒ la politique REFUSE TOUT. Sur une connexion mise en pool, toute lecture
--   non scopée ultérieure renvoie 0 ligne — sans erreur. Reproduit le
--   2026-09-07 en SQL nu avec le rôle facture_app :
--     session fraîche         → 17 factures ;
--     BEGIN set_config COMMIT → GUC = '' ;
--     lecture non scopée      → 0 facture.
--
-- Le correctif : `nullif(current_setting(...), '')` partout. La chaîne vide
-- redevient équivalente à « pas de scope », donc la branche dormante retrouve
-- exactement la sémantique voulue par 20260829150000 et 20260905120000.
--
-- POSTURE ASSUMÉE : fail-OPEN sur GUC vide. Un scope posé à '' fait voir
-- toutes les lignes plutôt qu'aucune. C'est le comportement d'origine, et il
-- est nécessaire aux lectures délibérément globales de l'étape 1 (annuaire
-- NIF, listMine, resolveForNewUser, vérification publique, purge de
-- rétention, portail acheteur public). L'alternative fail-closed exigerait une
-- sentinelle explicite (ex. '__global__') sur chacune de ces lectures — décision
-- écartée le 2026-09-07.
--
-- ⚠ TOUTE POLITIQUE AJOUTÉE PLUS TARD doit employer nullif(...) de la même
--   façon. Sans lui, elle sera dormante en apparence et bloquante en pratique.
--
-- Rejoue l'intégralité des politiques (CREATE OR REPLACE / DROP puis CREATE) :
-- idempotent, aucune donnée touchée, aucune ENABLE nouvelle.

-- ── Prédicat mandat, factorisé ────────────────────────────────────────────────
-- STABLE (lit un GUC + la table mandate — constant le temps d'une requête).
-- SECURITY INVOKER + search_path='' (même discipline que reject_invoice_event_mutation) :
-- s'exécute avec les droits de l'appelant, `public.` explicite partout. Les
-- politiques l'appellent en `public.rls_practice_sees_org(...)` (qualifié) — un
-- rôle applicatif ne peut pas la shadow. Pas de récursion : `mandate` n'appelle
-- jamais cette fonction (politique directe sur `practice_id`).
CREATE OR REPLACE FUNCTION public.rls_practice_sees_org(target_org_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
  AS $$
    SELECT nullif(current_setting('app.current_practice_id', true), '') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.mandate m
         WHERE m.organization_id = target_org_id
           AND m.practice_id = nullif(current_setting('app.current_practice_id', true), '')
           AND m.status = 'active'
           AND (m.expires_at IS NULL OR m.expires_at > now())
       );
  $$;

-- ── Tables à `organization_id` direct — prédicat uniforme ─────────────────────
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_recovery_request','api_key','assisted_session','bank_transaction',
    'branch','commission_bypass_case','credit_limit_change_request','customer',
    'fiscal_period_closing','invoice','invoice_sequence','organization_member',
    'organization_signing_key','product','recurring_invoice_template','ussd_session'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($fmt$
      CREATE POLICY org_isolation ON %1$I FOR ALL
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
      )
    $fmt$, t);
  END LOOP;
END
$do$;

-- ── Tables indirectes via `invoice_id` — prédicat uniforme ────────────────────
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payment','invoice_line','credit_note','invoice_event','refund','payment_provider_attempt'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($fmt$
      CREATE POLICY org_isolation ON %1$I FOR ALL
      USING (
        (nullif(current_setting('app.current_org_id', true), '') IS NULL
         AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice i
          WHERE i.id = %1$I.invoice_id
            AND (i.organization_id = nullif(current_setting('app.current_org_id', true), '')
                 OR public.rls_practice_sees_org(i.organization_id))
        )
      )
      WITH CHECK (
        (nullif(current_setting('app.current_org_id', true), '') IS NULL
         AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice i
          WHERE i.id = %1$I.invoice_id
            AND (i.organization_id = nullif(current_setting('app.current_org_id', true), '')
                 OR public.rls_practice_sees_org(i.organization_id))
        )
      )
    $fmt$, t);
  END LOOP;
END
$do$;

-- ── credit_note_line : via credit_note → invoice ────────────────────────────
DROP POLICY IF EXISTS org_isolation ON "credit_note_line";
CREATE POLICY org_isolation ON "credit_note_line" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.credit_note cn JOIN public.invoice i ON i.id = cn.invoice_id
      WHERE cn.id = credit_note_line.credit_note_id
        AND (i.organization_id = nullif(current_setting('app.current_org_id', true), '')
             OR public.rls_practice_sees_org(i.organization_id))
    )
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.credit_note cn JOIN public.invoice i ON i.id = cn.invoice_id
      WHERE cn.id = credit_note_line.credit_note_id
        AND (i.organization_id = nullif(current_setting('app.current_org_id', true), '')
             OR public.rls_practice_sees_org(i.organization_id))
    )
  );

-- ── product_stock : via product → organization ─────────────────────────────
DROP POLICY IF EXISTS org_isolation ON "product_stock";
CREATE POLICY org_isolation ON "product_stock" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.product p
      WHERE p.id = product_stock.product_id
        AND (p.organization_id = nullif(current_setting('app.current_org_id', true), '')
             OR public.rls_practice_sees_org(p.organization_id))
    )
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.product p
      WHERE p.id = product_stock.product_id
        AND (p.organization_id = nullif(current_setting('app.current_org_id', true), '')
             OR public.rls_practice_sees_org(p.organization_id))
    )
  );

-- ── organization : la ligne courante, ou une organisation mandatée ──────────
DROP POLICY IF EXISTS org_isolation ON "organization";
CREATE POLICY org_isolation ON "organization" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(id)
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR id = nullif(current_setting('app.current_org_id', true), '')
    OR public.rls_practice_sees_org(id)
  );

-- ── mandate : `practice_id` en direct (le cabinet voit ses mandats, tout statut) ──
DROP POLICY IF EXISTS org_isolation ON "mandate";
CREATE POLICY org_isolation ON "mandate" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR practice_id = nullif(current_setting('app.current_practice_id', true), '')
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR practice_id = nullif(current_setting('app.current_practice_id', true), '')
  );

-- ── revenue_share_credit : `practice_id` en direct ─────────────────────────
DROP POLICY IF EXISTS org_isolation ON "revenue_share_credit";
CREATE POLICY org_isolation ON "revenue_share_credit" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR practice_id = nullif(current_setting('app.current_practice_id', true), '')
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR practice_id = nullif(current_setting('app.current_practice_id', true), '')
  );

-- ── pending_member_invite : XOR org / practice (organization_id nullable) ───
DROP POLICY IF EXISTS org_isolation ON "pending_member_invite";
CREATE POLICY org_isolation ON "pending_member_invite" FOR ALL
  USING (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR practice_id = nullif(current_setting('app.current_practice_id', true), '')
  )
  WITH CHECK (
    (nullif(current_setting('app.current_org_id', true), '') IS NULL
     AND nullif(current_setting('app.current_practice_id', true), '') IS NULL)
    OR organization_id = nullif(current_setting('app.current_org_id', true), '')
    OR practice_id = nullif(current_setting('app.current_practice_id', true), '')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback : rejouer le corps de 20260905120000_rls_practice_scope tel quel
-- (il repose les mêmes politiques, sans le nullif). Attention : cela restaure
-- le défaut décrit en tête de ce fichier — à ne faire que si l'application
-- retourne au rôle propriétaire, qui contourne RLS de toute façon.
