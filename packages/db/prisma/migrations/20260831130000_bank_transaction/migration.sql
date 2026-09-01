-- Lot rapprochement bancaire (ADR-052, ADR-117 provisoire) — une ligne de relevé
-- bancaire importée (virement ENTRANT) et son état de rapprochement.
--
-- Colonnes d'IDENTITÉ (organization_id, import_batch_id, value_date,
-- amount_centimes, raw_label, fingerprint, created_at) IMMUABLES : trigger
-- bank_transaction_identity_immutable (pattern J1/E1). DELETE interdit (même
-- trigger). Colonnes d'ÉTAT (state, matched_invoice_id, matched_payment_id,
-- counterparty_label, bank_ref, resolved_by_user_id, resolved_at) libres :
-- unmatched -> matched | ignored.
-- TRUNCATE volontairement non couvert (reset des tests d'intégration / CI),
-- cohérent J1 / E1.
--
-- fingerprint UNIQUE : ré-importer le même relevé ne crée pas de doublons.
-- matched_payment_id UNIQUE : une transaction -> un Payment, un Payment
-- rapproché une seule fois. FK matched_invoice_id / matched_payment_id
-- ON DELETE RESTRICT (ni facture ni paiement ne se suppriment).
--
-- Table SCOPÉE ORGANISATION -> politique RLS standard org_isolation (dormante
-- par défaut, cf. 20260829150000_enable_row_level_security et
-- docs/runbooks/rls-rollout.md), contrairement à merkle_anchor_batch /
-- data_rights_request qui sont cross-organisation.

CREATE TYPE "BankTransactionState" AS ENUM ('unmatched', 'matched', 'ignored');

CREATE TABLE "bank_transaction" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "value_date" DATE NOT NULL,
    "amount_centimes" BIGINT NOT NULL,
    "raw_label" TEXT NOT NULL,
    "counterparty_label" TEXT,
    "bank_ref" TEXT,
    "fingerprint" TEXT NOT NULL,
    "state" "BankTransactionState" NOT NULL DEFAULT 'unmatched',
    "matched_invoice_id" TEXT,
    "matched_payment_id" TEXT,
    "imported_by_user_id" TEXT NOT NULL,
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transaction_pkey" PRIMARY KEY ("id"),
    -- Virements ENTRANTS uniquement : rend l'invariant irreprésentable en base,
    -- pas seulement vérifié par le DTO Zod (.positive()).
    CONSTRAINT "bank_transaction_amount_positive" CHECK ("amount_centimes" > 0),
    -- Lie l'enum d'état aux colonnes de résolution — rend les états incohérents
    -- IRREPRÉSENTABLES, pas seulement vérifiés par le service :
    --   unmatched  <=> aucun résolveur (resolved_at / resolved_by_user_id nuls)
    --   matched    <=> matched_invoice_id renseigné (ignored ne l'a jamais)
    --   matched_payment_id renseigné => state = matched (null tolérable tant que
    --     le paiement n'est pas encore créé, entre la revendication et l'étape 3)
    CONSTRAINT "bank_transaction_state_consistency" CHECK (
      (("state" = 'unmatched') = ("resolved_at" IS NULL))
      AND (("state" = 'unmatched') = ("resolved_by_user_id" IS NULL))
      AND (("state" = 'matched') = ("matched_invoice_id" IS NOT NULL))
      AND (("state" = 'matched') OR ("matched_payment_id" IS NULL))
    )
);

CREATE UNIQUE INDEX "bank_transaction_fingerprint_key" ON "bank_transaction"("fingerprint");
CREATE UNIQUE INDEX "bank_transaction_matched_payment_id_key" ON "bank_transaction"("matched_payment_id");
CREATE INDEX "bank_transaction_organization_id_state_idx" ON "bank_transaction"("organization_id", "state");

ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matched_invoice_id_fkey"
    FOREIGN KEY ("matched_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matched_payment_id_fkey"
    FOREIGN KEY ("matched_payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_imported_by_user_id_fkey"
    FOREIGN KEY ("imported_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_resolved_by_user_id_fkey"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Immuabilité des colonnes d'identité + DELETE interdit (pattern J1/E1) ────
CREATE OR REPLACE FUNCTION reject_bank_transaction_identity_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_transaction : DELETE interdit (rapprochement bancaire, ADR-052/ADR-117)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.organization_id  IS DISTINCT FROM OLD.organization_id
  OR NEW.import_batch_id  IS DISTINCT FROM OLD.import_batch_id
  OR NEW.value_date       IS DISTINCT FROM OLD.value_date
  OR NEW.amount_centimes  IS DISTINCT FROM OLD.amount_centimes
  OR NEW.raw_label        IS DISTINCT FROM OLD.raw_label
  OR NEW.fingerprint      IS DISTINCT FROM OLD.fingerprint
  OR NEW.imported_by_user_id IS DISTINCT FROM OLD.imported_by_user_id
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'bank_transaction : colonnes d''identité immuables (ADR-052/ADR-117)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER bank_transaction_identity_immutable
  BEFORE UPDATE OR DELETE ON "bank_transaction"
  FOR EACH ROW EXECUTE FUNCTION reject_bank_transaction_identity_mutation();

-- ── RLS standard org_isolation (DORMANTE — cf. 20260829150000) ──────────────
ALTER TABLE "bank_transaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "bank_transaction" FOR ALL
  USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL OR organization_id = current_setting('app.current_org_id', true));
