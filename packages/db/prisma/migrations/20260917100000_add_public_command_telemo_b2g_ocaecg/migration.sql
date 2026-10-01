-- CHANTIER 4 — Commande publique Telemo, dossiers B2G et validation OCAECG.

-- CreateEnum
CREATE TYPE "B2GCaseStatus" AS ENUM (
  'BROUILLON',
  'TRANSMIS',
  'SERVICE_FAIT_VALIDE',
  'CREANCE_CERTIFIEE',
  'OBJECTION_GEL_LITIGE',
  'PAYEE'
);

-- CreateTable
CREATE TABLE "telemo_award" (
  "id" TEXT NOT NULL,
  "telemo_award_id" TEXT NOT NULL,
  "telemo_contract_id" TEXT NOT NULL,
  "supplier_nif" TEXT NOT NULL,
  "amount_centimes" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organization_id" TEXT,

  CONSTRAINT "telemo_award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2g_case" (
  "id" TEXT NOT NULL,
  "case_number" TEXT NOT NULL,
  "status" "B2GCaseStatus" NOT NULL DEFAULT 'BROUILLON',
  "telemo_award_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "daf_signature" TEXT,
  "validated_at" TIMESTAMP(3),

  CONSTRAINT "b2g_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocaecg_license" (
  "id" TEXT NOT NULL,
  "license_number" TEXT NOT NULL,
  "firm_name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "cabinet_id" TEXT,

  CONSTRAINT "ocaecg_license_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telemo_award_telemo_award_id_key" ON "telemo_award"("telemo_award_id");
CREATE INDEX "telemo_award_supplier_nif_status_idx" ON "telemo_award"("supplier_nif", "status");
CREATE INDEX "telemo_award_organization_id_idx" ON "telemo_award"("organization_id");
CREATE UNIQUE INDEX "b2g_case_case_number_key" ON "b2g_case"("case_number");
CREATE UNIQUE INDEX "b2g_case_invoice_id_key" ON "b2g_case"("invoice_id");
CREATE INDEX "b2g_case_organization_id_status_idx" ON "b2g_case"("organization_id", "status");
CREATE UNIQUE INDEX "ocaecg_license_license_number_key" ON "ocaecg_license"("license_number");
CREATE UNIQUE INDEX "ocaecg_license_cabinet_id_key" ON "ocaecg_license"("cabinet_id");

-- AddForeignKey
ALTER TABLE "telemo_award" ADD CONSTRAINT "telemo_award_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "b2g_case" ADD CONSTRAINT "b2g_case_telemo_award_id_fkey"
  FOREIGN KEY ("telemo_award_id") REFERENCES "telemo_award"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2g_case" ADD CONSTRAINT "b2g_case_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2g_case" ADD CONSTRAINT "b2g_case_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ocaecg_license" ADD CONSTRAINT "ocaecg_license_cabinet_id_fkey"
  FOREIGN KEY ("cabinet_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
