-- OCR multicanal — note vocale PWA et WhatsApp (texte/voix), plan
-- docs/plans/2026-09-16-ocr-multicanal-vocal-whatsapp.md. Extension ADDITIVE
-- de ocr_document (ADR-122 reste la décision de fond, aucun second modèle).
--
-- RLS : RIEN À AJOUTER — ocr_document et organization sont déjà sous
-- ENABLE + FORCE ROW LEVEL SECURITY (migrations 20260911120000 et la mise en
-- place initiale) ; une politique porte sur la ligne, pas sur la liste des
-- colonnes (même raisonnement que 20260916140000_product_catalog_fields).
--
-- whatsapp_message_id est UNIQUE SEUL, pas composite avec organization_id :
-- c'est l'espace d'identifiants de Meta (wamid…), globalement unique par
-- construction. Un P2002 dessus ne peut survenir que sur une re-livraison du
-- MÊME message par Meta vers NOTRE webhook — aucune fuite inter-tenant : la
-- valeur n'est jamais fournie par un appelant, seulement par notre propre
-- guichet WhatsApp après vérification de signature.
--
-- ATTENTION ALTER TYPE ... ADD VALUE : Postgres interdit d'utiliser une
-- valeur d'enum tout juste ajoutée dans LA MÊME transaction qui l'a créée.
-- Cette migration ne contient aucun DML qui référence 'whatsapp' — seulement
-- des DDL — donc sûre telle quelle. Ne JAMAIS ajouter un seed/smoke-test qui
-- insère emission_channel='whatsapp' dans ce même fichier.

-- CreateEnum
CREATE TYPE "OcrDocumentSource" AS ENUM ('IMAGE_SCAN', 'AUDIO_PWA', 'WHATSAPP_VOICE', 'WHATSAPP_TEXT');

-- AlterTable — colonnes neuves, additives
ALTER TABLE "ocr_document"
  ADD COLUMN "source" "OcrDocumentSource" NOT NULL DEFAULT 'IMAGE_SCAN',
  ADD COLUMN "audio_sha256" TEXT,
  ADD COLUMN "text_brut" TEXT,
  ADD COLUMN "whatsapp_message_id" TEXT;

-- AlterTable — nullabilité élargie (photo reste NOT NULL en pratique, la
-- contrainte applicative vit dans les DTO/services par source)
ALTER TABLE "ocr_document" ALTER COLUMN "image_sha256" DROP NOT NULL;
ALTER TABLE "ocr_document" ALTER COLUMN "storage_key" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ocr_document_organization_id_audio_sha256_key" ON "ocr_document"("organization_id", "audio_sha256");
CREATE UNIQUE INDEX "ocr_document_whatsapp_message_id_key" ON "ocr_document"("whatsapp_message_id");

-- AlterTable
ALTER TABLE "organization" ADD COLUMN "whatsapp_ocr_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum
ALTER TYPE "EmissionChannel" ADD VALUE 'whatsapp';
