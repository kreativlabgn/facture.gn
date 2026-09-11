-- Hub de Vision Souveraine (ADR-122) — registre des factures papier scannées
-- depuis la PWA et de ce que le serveur a décidé de la lecture du modèle.
--
-- DDL généré par `prisma migrate dev --create-only` (base d'ombre disponible
-- sur ce poste depuis le 11/09, contrairement aux migrations PDP écrites à la
-- main) ; seule la section RLS ci-dessous est ajoutée après coup.
--
-- ── POURQUOI LA SECTION RLS EST INDISPENSABLE ────────────────────────────────
-- ocr_document porte organization_id en direct et son contenu est la lecture
-- BRUTE d'une facture d'une PME : client, lignes, montants. Sans politique,
-- elle serait le seul trou du registre RLS. L'application
-- tourne en facture_app (NOBYPASSRLS) : une table sans politique y reste
-- intégralement lisible par TOUTE organisation — donc un commerçant verrait
-- les scans de son voisin de Madina.
--
-- Le prédicat emploie `nullif(current_setting(...), '')` — pas
-- `current_setting(...) IS NULL`. Voir 20260907010000_rls_dormancy_empty_string.
-- FORCE est posé dans la foulée (20260907020000).

-- CreateEnum
CREATE TYPE "OcrDocumentStatus" AS ENUM ('RECEIVED', 'AUTO_INSERTED', 'DRAFT_PENDING_MANUAL_REVIEW', 'REJECTED');

-- CreateTable
CREATE TABLE "ocr_document" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "image_sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "OcrDocumentStatus" NOT NULL DEFAULT 'RECEIVED',
    "model_id" TEXT,
    "extraction" JSONB,
    "total_ht_centimes" BIGINT,
    "total_vat_centimes" BIGINT,
    "total_ttc_centimes" BIGINT,
    "saisie_regime" "SaisieRegime",
    "review_findings" JSONB,
    "rejection_reason" TEXT,
    "invoice_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "ocr_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocr_document_invoice_id_key" ON "ocr_document"("invoice_id");

-- CreateIndex
CREATE INDEX "ocr_document_organization_id_status_idx" ON "ocr_document"("organization_id", "status");

-- CreateIndex
-- L'IDEMPOTENCE DU SCAN. Le même cliché renvoyé après un timeout 3G frappe ce
-- UNIQUE, la perdante reçoit P2002 et OcrVisionService rend le registre déjà
-- créé — jamais un second brouillon sur la même facture papier.
CREATE UNIQUE INDEX "ocr_document_organization_id_image_sha256_key" ON "ocr_document"("organization_id", "image_sha256");

-- AddForeignKey
ALTER TABLE "ocr_document" ADD CONSTRAINT "ocr_document_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_document" ADD CONSTRAINT "ocr_document_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_document" ADD CONSTRAINT "ocr_document_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS : ocr_document rejoint le registre ───────────────────────────────────
ALTER TABLE "ocr_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ocr_document" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON "ocr_document";
CREATE POLICY org_isolation ON "ocr_document" FOR ALL
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
  );

-- Le rôle applicatif : ALTER DEFAULT PRIVILEGES (script d'armement) couvre les
-- tables créées ensuite, mais on l'explicite ici pour que cette migration soit
-- autonome — rejouable sur une base où le rôle existe déjà.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'facture_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ocr_document" TO facture_app;
  END IF;
END
$do$;
