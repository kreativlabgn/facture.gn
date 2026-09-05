-- Chantier A (ADR-111 phase 2) — Row-Level Security : scope PRACTICE (cabinet/CGA).
--
-- Étend les politiques `org_isolation` posées par 20260829150000 (par ORGANISATION)
-- pour couvrir aussi l'accès délégué d'un cabinet comptable / gestionnaire /
-- fiduciaire / CGA à ses organisations MANDATÉES (DAT §7.2 : « Isolation RLS :
-- SET app.current_practice ». ERD : PROFESSIONAL_PRACTICE ── MANDATE ── ORGANIZATION).
--
-- ── TOUJOURS DORMANT PAR DÉFAUT ────────────────────────────────────────────────
-- Le prédicat d'échappement passe de
--     current_setting('app.current_org_id', true) IS NULL OR ...
-- à
--     (app.current_org_id IS NULL AND app.current_practice_id IS NULL) OR ...
-- → tant qu'AUCUN des deux GUC de session n'est défini, la politique laisse tout
--   passer. Combiné à `ENABLE` sans `FORCE` (le propriétaire des tables bypasse),
--   la bascule réelle reste l'étape supervisée du runbook (docs/runbooks/rls-rollout.md).
--
-- ── POURQUOI UNE SEULE POLITIQUE COMBINÉE (et non une 2e politique `practice_isolation`) ──
-- Sous PostgreSQL, deux politiques PERMISSIVES pour la même commande sont OU-ées.
-- Une politique `practice_isolation` distincte, dormante via
-- `current_setting('app.current_practice_id', true) IS NULL OR ...`, renverrait TRUE
-- pour TOUTES les lignes dès qu'une requête ne définit QUE `app.current_org_id`
-- (cas d'une PME normale) — l'échappement de l'une neutralisant le filtre de
-- l'autre. La seule forme correcte est un prédicat unique dont l'échappement
-- dormant exige que les DEUX GUC soient nuls.
--
-- ── MODÈLE D'ACCÈS ────────────────────────────────────────────────────────────
--   app.current_org_id      seul  : une PME voit ses propres données (inchangé).
--   app.current_practice_id seul  : un cabinet voit les données de TOUTES ses
--                                   organisations à mandat `active` non expiré
--                                   (vue transversale, DAT §7.2).
--   les deux                      : un cabinet « entré » dans une organisation
--                                   précise — l'accès est accordé si l'org match
--                                   OU si le mandat existe.
--
-- `mandate` et `revenue_share_credit` portent `practice_id` en direct : le cabinet
-- voit ses propres lignes (tout statut), pas via une sous-requête mandat.
-- `pending_member_invite` : XOR org/practice — filtré sur l'un ou l'autre GUC.
--
-- Non couvert (comme 20260829150000) : `professional_practice`, `practice_member`
-- n'ont jamais eu de RLS — hors périmètre ici (aucune ENABLE nouvelle dans cette
-- migration, uniquement des politiques remplacées). `merkle_anchor_batch`,
-- `payment_webhook`, `data_rights_request` restent cross-organisation → jamais de RLS.
--
-- SQL non exécutable sans Postgres dans cet environnement (comme 20260830120000) :
-- `prisma migrate deploy` passe le fichier entier à Postgres (dollar-quoting `$$`
-- géré). Validation réelle = étape gate du runbook sur staging (≥ 2 orgs + 1 cabinet
-- mandaté), et `packages/db/src/rls.integration.spec.ts` (RLS_INTEGRATION_TEST=1).

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
    SELECT current_setting('app.current_practice_id', true) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.mandate m
         WHERE m.organization_id = target_org_id
           AND m.practice_id = current_setting('app.current_practice_id', true)
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
        (current_setting('app.current_org_id', true) IS NULL
         AND current_setting('app.current_practice_id', true) IS NULL)
        OR organization_id = current_setting('app.current_org_id', true)
        OR public.rls_practice_sees_org(organization_id)
      )
      WITH CHECK (
        (current_setting('app.current_org_id', true) IS NULL
         AND current_setting('app.current_practice_id', true) IS NULL)
        OR organization_id = current_setting('app.current_org_id', true)
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
        (current_setting('app.current_org_id', true) IS NULL
         AND current_setting('app.current_practice_id', true) IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice i
          WHERE i.id = %1$I.invoice_id
            AND (i.organization_id = current_setting('app.current_org_id', true)
                 OR public.rls_practice_sees_org(i.organization_id))
        )
      )
      WITH CHECK (
        (current_setting('app.current_org_id', true) IS NULL
         AND current_setting('app.current_practice_id', true) IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice i
          WHERE i.id = %1$I.invoice_id
            AND (i.organization_id = current_setting('app.current_org_id', true)
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
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.credit_note cn JOIN public.invoice i ON i.id = cn.invoice_id
      WHERE cn.id = credit_note_line.credit_note_id
        AND (i.organization_id = current_setting('app.current_org_id', true)
             OR public.rls_practice_sees_org(i.organization_id))
    )
  )
  WITH CHECK (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.credit_note cn JOIN public.invoice i ON i.id = cn.invoice_id
      WHERE cn.id = credit_note_line.credit_note_id
        AND (i.organization_id = current_setting('app.current_org_id', true)
             OR public.rls_practice_sees_org(i.organization_id))
    )
  );

-- ── product_stock : via product → organization ─────────────────────────────
DROP POLICY IF EXISTS org_isolation ON "product_stock";
CREATE POLICY org_isolation ON "product_stock" FOR ALL
  USING (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.product p
      WHERE p.id = product_stock.product_id
        AND (p.organization_id = current_setting('app.current_org_id', true)
             OR public.rls_practice_sees_org(p.organization_id))
    )
  )
  WITH CHECK (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.product p
      WHERE p.id = product_stock.product_id
        AND (p.organization_id = current_setting('app.current_org_id', true)
             OR public.rls_practice_sees_org(p.organization_id))
    )
  );

-- ── organization : la ligne courante, ou une organisation mandatée ──────────
DROP POLICY IF EXISTS org_isolation ON "organization";
CREATE POLICY org_isolation ON "organization" FOR ALL
  USING (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR id = current_setting('app.current_org_id', true)
    OR public.rls_practice_sees_org(id)
  )
  WITH CHECK (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR id = current_setting('app.current_org_id', true)
    OR public.rls_practice_sees_org(id)
  );

-- ── mandate : `practice_id` en direct (le cabinet voit ses mandats, tout statut) ──
DROP POLICY IF EXISTS org_isolation ON "mandate";
CREATE POLICY org_isolation ON "mandate" FOR ALL
  USING (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR organization_id = current_setting('app.current_org_id', true)
    OR practice_id = current_setting('app.current_practice_id', true)
  )
  WITH CHECK (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR organization_id = current_setting('app.current_org_id', true)
    OR practice_id = current_setting('app.current_practice_id', true)
  );

-- ── revenue_share_credit : `practice_id` en direct ─────────────────────────
DROP POLICY IF EXISTS org_isolation ON "revenue_share_credit";
CREATE POLICY org_isolation ON "revenue_share_credit" FOR ALL
  USING (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR organization_id = current_setting('app.current_org_id', true)
    OR practice_id = current_setting('app.current_practice_id', true)
  )
  WITH CHECK (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR organization_id = current_setting('app.current_org_id', true)
    OR practice_id = current_setting('app.current_practice_id', true)
  );

-- ── pending_member_invite : XOR org / practice (organization_id nullable) ───
DROP POLICY IF EXISTS org_isolation ON "pending_member_invite";
CREATE POLICY org_isolation ON "pending_member_invite" FOR ALL
  USING (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR organization_id = current_setting('app.current_org_id', true)
    OR practice_id = current_setting('app.current_practice_id', true)
  )
  WITH CHECK (
    (current_setting('app.current_org_id', true) IS NULL
     AND current_setting('app.current_practice_id', true) IS NULL)
    OR organization_id = current_setting('app.current_org_id', true)
    OR practice_id = current_setting('app.current_practice_id', true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (revenir aux politiques par organisation seule de 20260829150000) :
--   1. Rejouer le corps de 20260829150000_enable_row_level_security (chaque
--      `CREATE POLICY org_isolation ...` après un `DROP POLICY IF EXISTS`).
--   2. `DROP FUNCTION IF EXISTS public.rls_practice_sees_org(text);`
-- Aucune donnée touchée ; les politiques restent dormantes tant que les GUC ne
-- sont pas posés.
