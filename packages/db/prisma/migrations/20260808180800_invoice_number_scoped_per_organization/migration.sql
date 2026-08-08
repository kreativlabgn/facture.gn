-- DropIndex
DROP INDEX "invoice_number_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoice_organization_id_number_key" ON "invoice"("organization_id", "number");
