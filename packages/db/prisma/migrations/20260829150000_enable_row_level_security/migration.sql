-- Lot I (C2, ADR-111) — Row-Level Security PostgreSQL par organisation.
--
-- DORMANT PAR DÉFAUT. Deux verrous :
--   1. `ENABLE` sans `FORCE` -> le propriétaire des tables (rôle de migration /
--      rôle applicatif actuel) contourne toujours RLS.
--   2. Chaque politique commence par
--        current_setting('app.current_org_id', true) IS NULL OR ...
--      -> tant que le paramètre de session n'est pas défini, la politique
--      laisse tout passer.
--
-- Activation réelle = étape supervisée (docs/runbooks/rls-rollout.md) : créer un
-- rôle applicatif NON-propriétaire sans BYPASSRLS, basculer DATABASE_URL dessus,
-- puis FORCE ROW LEVEL SECURITY. `organizationScopedClient` / `setOrganizationScope`
-- (packages/db) sont les seuls émetteurs du set_config('app.current_org_id', ...).
--
-- SQL volontairement plat (pas de bloc DO $$, pas de fonction) — compatible avec
-- tout exécuteur de migration, y compris un découpage naïf sur ';'.
--
-- Couverture : 18 tables à organization_id direct + organization + 8 indirectes.
-- NON couvert (ADR-111, phase 2) : payment_webhook (pas de lien org),
-- pending_member_invite partiellement (XOR org/practice), tables scoped-practice.

-- ── Tables à organization_id direct ─────────────────────────────────────────
ALTER TABLE "account_recovery_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "account_recovery_request" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "api_key" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "assisted_session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "assisted_session" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "branch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "branch" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "commission_bypass_case" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "commission_bypass_case" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "credit_limit_change_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "credit_limit_change_request" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "customer" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "fiscal_period_closing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "fiscal_period_closing" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "invoice" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "invoice_sequence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "invoice_sequence" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "mandate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "mandate" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "organization_member" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "organization_member" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "organization_signing_key" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "organization_signing_key" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "product" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "recurring_invoice_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "recurring_invoice_template" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "revenue_share_credit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "revenue_share_credit" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

ALTER TABLE "ussd_session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "ussd_session" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));

-- pending_member_invite : organization_id nullable (XOR practice_id). Une
-- invitation scoped-practice (organization_id NULL) passe toujours.
ALTER TABLE "pending_member_invite" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "pending_member_invite" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id IS NULL OR organization_id = current_setting('app.current_org_id', true));

-- organization : la ligne de l'organisation courante uniquement.
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "organization" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR id = current_setting('app.current_org_id', true));

-- ── Tables indirectes via invoice_id ───────────────────────────────────────
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "payment" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = payment.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = payment.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)));

ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "invoice_line" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = invoice_line.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = invoice_line.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)));

ALTER TABLE "credit_note" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "credit_note" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = credit_note.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = credit_note.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)));

ALTER TABLE "invoice_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "invoice_event" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = invoice_event.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = invoice_event.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)));

ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "refund" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = refund.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = refund.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)));

ALTER TABLE "payment_provider_attempt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "payment_provider_attempt" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = payment_provider_attempt.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM invoice i WHERE i.id = payment_provider_attempt.invoice_id AND i.organization_id = current_setting('app.current_org_id', true)));

-- credit_note_line : via credit_note -> invoice.
ALTER TABLE "credit_note_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "credit_note_line" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM credit_note cn JOIN invoice i ON i.id = cn.invoice_id WHERE cn.id = credit_note_line.credit_note_id AND i.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM credit_note cn JOIN invoice i ON i.id = cn.invoice_id WHERE cn.id = credit_note_line.credit_note_id AND i.organization_id = current_setting('app.current_org_id', true)));

-- product_stock : via product -> organization.
ALTER TABLE "product_stock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "product_stock" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM product p WHERE p.id = product_stock.product_id AND p.organization_id = current_setting('app.current_org_id', true)))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR EXISTS (SELECT 1 FROM product p WHERE p.id = product_stock.product_id AND p.organization_id = current_setting('app.current_org_id', true)));
