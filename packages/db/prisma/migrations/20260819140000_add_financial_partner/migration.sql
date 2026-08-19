-- AlterEnum
ALTER TYPE "InvoiceEventType" ADD VALUE 'financing_disbursed';

-- CreateEnum
CREATE TYPE "FinancialPartnerType" AS ENUM ('banque', 'mfi');

-- CreateEnum
CREATE TYPE "FinancialPartnerStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "financial_partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialPartnerType" NOT NULL,
    "api_key" TEXT,
    "status" "FinancialPartnerStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_partner_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_financed_by_partner_id_fkey" FOREIGN KEY ("financed_by_partner_id") REFERENCES "financial_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed — premiers partenaires financiers identifiés (ADR-088, consequences) :
-- 2 banques + 2 MFI, connus à l'avance, jamais un self-service PME (voir PLAN
-- "Clarifications" — aucun endpoint de création).
INSERT INTO "financial_partner" ("id", "name", "type", "status") VALUES
    (gen_random_uuid(), 'Ecobank', 'banque', 'active'),
    (gen_random_uuid(), 'UBA', 'banque', 'active'),
    (gen_random_uuid(), 'COFINA', 'mfi', 'active'),
    (gen_random_uuid(), 'Akiba Finance', 'mfi', 'active');
