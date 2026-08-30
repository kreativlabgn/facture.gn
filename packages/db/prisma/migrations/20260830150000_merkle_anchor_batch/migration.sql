-- Lot E1 (ADR-115 provisoire) — registre des racines de Merkle des factures,
-- chaîné, destiné à un ancrage externe (seam AnchorSink).
--
-- Colonnes d'identité (as_of, coverage_from, merkle_root, previous_root,
-- leaf_count, created_at) IMMUABLES : trigger merkle_anchor_batch_identity_immutable
-- (pattern Lot J1). Les colonnes anchor_* / anchored_at / anchor_attempts
-- restent modifiables (write-once-later par le flush). DELETE et TRUNCATE
-- interdits (triggers ROW + STATEMENT).
--
-- CHECK merkle_anchor_batch_status_consistency : lie l'enum aux colonnes de
-- résultat (anchored ⟺ anchored_at ; proof/ref ensemble ; proof ⟹ anchored) —
-- rend les états incohérents IRREPRÉSENTABLES, pas seulement vérifiés par le
-- seul call site du flush.
--
-- Table CROSS-ORGANISATION (une tranche couvre N organisations) → PAS de
-- politique RLS (comme payment_webhook, cf. docs/runbooks/rls-rollout.md).

CREATE TYPE "MerkleAnchorStatus" AS ENUM ('pending', 'anchored', 'failed');

CREATE TABLE "merkle_anchor_batch" (
    "id" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "coverage_from" TIMESTAMP(3) NOT NULL,
    "merkle_root" TEXT NOT NULL,
    "previous_root" TEXT NOT NULL,
    "leaf_count" INTEGER NOT NULL,
    "anchor_status" "MerkleAnchorStatus" NOT NULL DEFAULT 'pending',
    "anchor_proof" TEXT,
    "anchor_ref" TEXT,
    "anchored_at" TIMESTAMP(3),
    "anchor_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merkle_anchor_batch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merkle_anchor_batch_status_consistency" CHECK (
      (("anchor_status" = 'anchored') = ("anchored_at" IS NOT NULL))
      AND (("anchor_proof" IS NULL) = ("anchor_ref" IS NULL))
      AND (("anchor_proof" IS NULL) OR ("anchor_status" = 'anchored'))
    )
);

CREATE UNIQUE INDEX "merkle_anchor_batch_as_of_key" ON "merkle_anchor_batch"("as_of");
-- Chaînage non forkable : au plus une tranche par prédécesseur. Deux runs de
-- scellement concurrents d'as_of différents qui liraient la même dernière
-- tranche → le second insert échoue (unique_violation), ses factures repartent
-- au run suivant (garde anchor_batch_id IS NULL). 'GENESIS' n'apparaît qu'une fois.
CREATE UNIQUE INDEX "merkle_anchor_batch_previous_root_key" ON "merkle_anchor_batch"("previous_root");
CREATE INDEX "merkle_anchor_batch_anchor_status_idx" ON "merkle_anchor_batch"("anchor_status");

ALTER TABLE "invoice" ADD COLUMN "anchor_batch_id" TEXT;
CREATE INDEX "invoice_anchor_batch_id_idx" ON "invoice"("anchor_batch_id");
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_anchor_batch_id_fkey"
    FOREIGN KEY ("anchor_batch_id") REFERENCES "merkle_anchor_batch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Immuabilité du registre ────────────────────────────────────────────────
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
  IF NEW.as_of         IS DISTINCT FROM OLD.as_of
  OR NEW.coverage_from IS DISTINCT FROM OLD.coverage_from
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

CREATE OR REPLACE FUNCTION reject_merkle_anchor_batch_truncate() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  RAISE EXCEPTION 'merkle_anchor_batch est append-only (E1/ADR-115) : TRUNCATE interdit'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE TRIGGER merkle_anchor_batch_no_truncate
  BEFORE TRUNCATE ON "merkle_anchor_batch"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_merkle_anchor_batch_truncate();

-- ── Invoice.anchor_batch_id : write-once ───────────────────────────────────
-- Une facture ne change JAMAIS de tranche légitimement. Rejette toute
-- ré-assignation d'une valeur non nulle (l'assignation NULL → id par le
-- scellement reste permise).
CREATE OR REPLACE FUNCTION reject_invoice_anchor_batch_reassignment() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.anchor_batch_id IS NOT NULL
  AND NEW.anchor_batch_id IS DISTINCT FROM OLD.anchor_batch_id THEN
    RAISE EXCEPTION 'invoice.anchor_batch_id est write-once (E1/ADR-115) : ré-assignation interdite'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER invoice_anchor_batch_id_write_once
  BEFORE UPDATE OF "anchor_batch_id" ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION reject_invoice_anchor_batch_reassignment();
