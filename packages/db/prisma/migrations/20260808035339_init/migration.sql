-- CreateEnum
CREATE TYPE "PreferredLanguage" AS ENUM ('fr', 'pular', 'malinke', 'soussou');

-- CreateEnum
CREATE TYPE "RegimeFiscal" AS ENUM ('normal_tva', 'tpu', 'normal_sans_tva', 'non_assujetti_association');

-- CreateEnum
CREATE TYPE "LegalForm" AS ENUM ('commercial', 'association');

-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('organic', 'apip', 'cga_referral', 'fodip', 'partner_3ae');

-- CreateEnum
CREATE TYPE "DgiVerificationStatus" AS ENUM ('unverified', 'pending', 'verified');

-- CreateEnum
CREATE TYPE "CommercialTier" AS ENUM ('freemium', 'starter', 'pro', 'enterprise', 'custom');

-- CreateEnum
CREATE TYPE "InvoiceDocumentType" AS ENUM ('invoice', 'proforma', 'quote');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'voided', 'converted', 'expired');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('none', 'disputed', 'resolved');

-- CreateEnum
CREATE TYPE "InvoiceEventType" AS ENUM ('cancellation_indemnity', 'no_show_forfeited', 'dispute_raised', 'dispute_resolved', 'payment_reminder_sent', 'payment_link_generated', 'payment_link_expired', 'payment_link_regenerated', 'invoice_voided', 'invoice_converted', 'overpayment_recorded', 'refund_issued', 'suspicious_cash_pattern_detected', 'stale_invoice_detected', 'mandate_requested', 'mandate_granted', 'mandate_revoked', 'mandate_expired', 'revenue_share_credited', 'regime_change', 'delegated_key_tier_changed', 'validation_revoked');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "preferred_language" "PreferredLanguage" NOT NULL DEFAULT 'fr',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_phone" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "user_phone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regime_fiscal" "RegimeFiscal" NOT NULL,
    "legal_form" "LegalForm" NOT NULL,
    "nif" TEXT NOT NULL,
    "etax_number" TEXT,
    "rccm" TEXT,
    "registration_source" "RegistrationSource" NOT NULL DEFAULT 'organic',
    "dgi_verification_status" "DgiVerificationStatus" NOT NULL DEFAULT 'unverified',
    "bank_account_details" JSONB,
    "preferred_language" "PreferredLanguage" NOT NULL DEFAULT 'fr',
    "chiffre_affaires_brut_declare" BIGINT NOT NULL DEFAULT 0,
    "payment_link_auto_send" BOOLEAN NOT NULL DEFAULT true,
    "commercial_tier" "CommercialTier" NOT NULL DEFAULT 'freemium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequence" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "customer_id" TEXT,
    "number" TEXT,
    "certification_id" TEXT,
    "document_type" "InvoiceDocumentType" NOT NULL DEFAULT 'invoice',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "dispute_status" "DisputeStatus" NOT NULL DEFAULT 'none',
    "validated_by_administration" BOOLEAN NOT NULL DEFAULT false,
    "total_ht" BIGINT NOT NULL DEFAULT 0,
    "total_tva" BIGINT NOT NULL DEFAULT 0,
    "total_ttc" BIGINT NOT NULL DEFAULT 0,
    "discount_pct" INTEGER NOT NULL DEFAULT 0,
    "amount_paid" BIGINT NOT NULL DEFAULT 0,
    "amount_due" BIGINT NOT NULL DEFAULT 0,
    "overpayment_amount" BIGINT NOT NULL DEFAULT 0,
    "payment_link_url" TEXT,
    "payment_link_id" TEXT,
    "payment_link_expires_at" TIMESTAMP(3),
    "reference_currency" TEXT,
    "reference_amount" BIGINT,
    "fx_rate" DECIMAL(65,30),
    "fx_rate_date" TIMESTAMP(3),
    "recurring_template_id" TEXT,
    "converted_to_invoice_id" TEXT,
    "quote_valid_until" TIMESTAMP(3),
    "reference_marche" TEXT,
    "financed_by_partner_id" TEXT,
    "financed_at" TIMESTAMP(3),
    "hash" TEXT,
    "previous_hash" TEXT,
    "signature" BYTEA,
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "cost_price_at_time" BIGINT,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_event" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "type" "InvoiceEventType" NOT NULL,
    "actor_id" TEXT,
    "amount" BIGINT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_msisdn_key" ON "user_phone"("msisdn");

-- CreateIndex
CREATE UNIQUE INDEX "organization_nif_key" ON "organization"("nif");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequence_organization_id_year_key" ON "invoice_sequence"("organization_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_certification_id_key" ON "invoice"("certification_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_converted_to_invoice_id_key" ON "invoice"("converted_to_invoice_id");

-- AddForeignKey
ALTER TABLE "user_phone" ADD CONSTRAINT "user_phone_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequence" ADD CONSTRAINT "invoice_sequence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_converted_to_invoice_id_fkey" FOREIGN KEY ("converted_to_invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
