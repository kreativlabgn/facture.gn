-- Lot E1 (ADR-115 provisoire) — registre horaire des racines de Merkle des
-- factures, chaîné, destiné à un ancrage externe (seam AnchorSink).
--
-- Colonnes d'identité (hour_start, merkle_root, previous_root, leaf_count,
-- created_at) IMMUABLES : trigger merkle_anchor_batch_identity_immutable
-- (pattern Lot J1). Les colonnes anchor_* / anchored_at restent modifiables
-- (write-once-later par le flush). DELETE interdit. TRUNCATE non couvert (reset
-- CI/tests) — voir docs/runbooks/merkle-anchor.md.
--
-- Table CROSS-ORGANISATION (une tranche couvre N organisations) → PAS de
-- politique RLS (comme payment_webhook, cf. docs/runbooks/rls-rollout.md).

CREATE TYPE "MerkleAnchorStatus" AS ENUM ('pending', 'anchored', 'failed');

CREATE TABLE "merkle_anchor_batch" (
    "id" TEXT NOT NULL,
    "hour_start" TIMESTAMP(3) NOT NULL,
    "merkle_root" TEXT NOT NULL,
    "previous_root" TEXT NOT NULL,
    "leaf_count" INTEGER NOT NULL,
    "anchor_status" "MerkleAnchorStatus" NOT NULL DEFAULT 'pending',
    "anchor_proof" TEXT,
    "anchor_ref" TEXT,
    "anchored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merkle_anchor_batch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merkle_anchor_batch_hour_start_key" ON "merkle_anchor_batch"("hour_start");
CREATE INDEX "merkle_anchor_batch_anchor_status_idx" ON "merkle_anchor_batch"("anchor_status");

ALTER TABLE "invoice" ADD COLUMN "anchor_batch_id" TEXT;
CREATE INDEX "invoice_anchor_batch_id_idx" ON "invoice"("anchor_batch_id");
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_anchor_batch_id_fkey"
    FOREIGN KEY ("anchor_batch_id") REFERENCES "merkle_anchor_batch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Immuabilité des colonnes d'identité + interdiction de DELETE.
CREATE OR REPLACE FUNCTION reject_merkle_anchor_batch_identity_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'merkle_anchor_batch est append-only (E1/ADR-115) : DELETE interdit'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.hour_start    IS DISTINCT FROM OLD.hour_start
  OR NEW.merkle_root   IS DISTINCT FROM OLD.merkle_root
  OR NEW.previous_root IS DISTINCT FROM OLD.previous_root
  OR NEW.leaf_count    IS DISTINCT FROM OLD.leaf_count
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merkle_anchor_batch : colonnes d''identité immuables (E1/ADR-115)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER merkle_anchor_batch_identity_immutable
  BEFORE UPDATE OR DELETE ON "merkle_anchor_batch"
  FOR EACH ROW EXECUTE FUNCTION reject_merkle_anchor_batch_identity_mutation();
