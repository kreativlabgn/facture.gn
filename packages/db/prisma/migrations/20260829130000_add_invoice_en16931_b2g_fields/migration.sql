-- CreateEnum
CREATE TYPE "InvoiceCadre" AS ENUM ('standard', 'marche_public');

-- AlterTable
-- Lot C, ADR-109 — champs B2G structurés (alignement EN 16931 / préparation
-- export UBL 2.1, ADR-053). Tous déclaratifs, recopiés sans vérification à
-- l'émission — même discipline que reference_marche (ADR-090). Jamais dans
-- CertifiablePayload. Additif : les factures existantes prennent
-- cadre_facturation = 'standard' et NULL sur les 3 références.
ALTER TABLE "invoice"
  ADD COLUMN "cadre_facturation" "InvoiceCadre" NOT NULL DEFAULT 'standard',
  ADD COLUMN "numero_bon_commande" TEXT,
  ADD COLUMN "numero_contrat" TEXT,
  ADD COLUMN "numero_engagement" TEXT;

-- AlterTable
-- EN 16931 BT-157 — identifiant standard de l'article (référence acheteur /
-- nomenclature), distinct de product_id (FK catalogue interne).
ALTER TABLE "invoice_line" ADD COLUMN "product_code" TEXT;
