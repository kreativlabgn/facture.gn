-- Lot J2 (ADR-116) — registre des demandes de droits des personnes
-- (L/2016/037). Preuve de responsabilité opposable au régulateur PDP.
--
-- APPEND-ONLY : même garde que invoice_event (J1, 20260830120000). Le trigger
-- BEFORE UPDATE OR DELETE FOR EACH ROW bloque toute mutation DML directe, pour
-- tous les rôles (y compris le superuser CI actuel). NE protège PAS contre un
-- rôle disposant du DDL (ALTER ... DISABLE TRIGGER / DROP TRIGGER) ni contre
-- TRUNCATE (trigger de niveau ligne) — ces vecteurs se referment avec la
-- bascule sur un rôle applicatif non propriétaire (rls-rollout.md étape 5 :
-- REVOKE UPDATE, DELETE, TRUNCATE ... FROM facture_app).
--
-- TRUNCATE volontairement non couvert (reset des tests d'intégration / CI).
--
-- Table CROSS-ORGANISATION (organization_id nullable pour le chemin ops
-- transverse) → PAS de politique RLS, comme merkle_anchor_batch / payment_webhook.

CREATE TYPE "DataRightsRequestKind" AS ENUM ('access', 'anonymization');
CREATE TYPE "DataRightsRequestOutcome" AS ENUM ('completed', 'partial', 'refused_legal_retention', 'failed');

CREATE TABLE "data_rights_request" (
    "id" TEXT NOT NULL,
    "kind" "DataRightsRequestKind" NOT NULL,
    "outcome" "DataRightsRequestOutcome" NOT NULL,
    "subject_phone_hash" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "via_ops" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" TEXT,
    "affected_customer_ids" TEXT[],
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_rights_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_rights_request_subject_phone_hash_idx" ON "data_rights_request"("subject_phone_hash");

-- ── Garde append-only (pattern J1) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_data_rights_request_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  RAISE EXCEPTION 'data_rights_request est append-only (ADR-116) : % interdit', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE TRIGGER data_rights_request_append_only
  BEFORE UPDATE OR DELETE ON "data_rights_request"
  FOR EACH ROW EXECUTE FUNCTION reject_data_rights_request_mutation();
