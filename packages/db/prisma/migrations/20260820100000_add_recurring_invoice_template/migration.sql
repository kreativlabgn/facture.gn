-- CreateTable
CREATE TABLE "recurring_invoice_template" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "branch_id" TEXT,
    "lines" JSONB NOT NULL,
    "discount_pct" INTEGER NOT NULL DEFAULT 0,
    "interval_days" INTEGER NOT NULL,
    "last_generated_at" TIMESTAMP(3),
    "last_known_regime_fiscal" "RegimeFiscal",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_invoice_template_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "recurring_invoice_template" ADD CONSTRAINT "recurring_invoice_template_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_template" ADD CONSTRAINT "recurring_invoice_template_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_template" ADD CONSTRAINT "recurring_invoice_template_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (invoice.recurring_template_id passe de scalaire orphelin à vraie FK, I1)
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_recurring_template_id_fkey" FOREIGN KEY ("recurring_template_id") REFERENCES "recurring_invoice_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
