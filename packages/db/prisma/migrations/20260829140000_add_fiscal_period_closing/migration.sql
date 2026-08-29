-- CreateTable
-- Lot B, ADR-110 — arrêté des comptes OHADA/SYSCOHADA. Sceau irréversible d'un
-- exercice comptable. @@unique(organization_id, year) : une seule clôture par
-- exercice (idempotence). Aucune contrainte de suppression/réouverture — une
-- erreur se corrige dans l'exercice suivant (principe OHADA).
CREATE TABLE "fiscal_period_closing" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_invoice_number" TEXT,
    "last_invoice_hash" TEXT,
    "total_ht" BIGINT NOT NULL,
    "total_tva" BIGINT NOT NULL,
    "total_ttc" BIGINT NOT NULL,
    "invoice_count" INTEGER NOT NULL,
    "seal_hash" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_user_id" TEXT NOT NULL,

    CONSTRAINT "fiscal_period_closing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_period_closing_organization_id_year_key" ON "fiscal_period_closing"("organization_id", "year");

-- AddForeignKey
ALTER TABLE "fiscal_period_closing" ADD CONSTRAINT "fiscal_period_closing_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_period_closing" ADD CONSTRAINT "fiscal_period_closing_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
