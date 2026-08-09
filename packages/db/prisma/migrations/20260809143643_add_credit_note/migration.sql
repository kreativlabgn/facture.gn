-- ADR-040, C7 — mécanisme de correction d'une facture déjà émise (avoir), jamais
-- une mutation directe de Invoice. Aucun index explicite sur les colonnes FK, par
-- cohérence avec le reste de ce schema (payment.invoice_id, invoice_line.invoice_id
-- n'en ont pas non plus) : à l'échelle MVP, les requêtes restent toujours scopées à
-- une seule facture (quelques lignes), pas de scan large à optimiser ici.

-- CreateTable
CREATE TABLE "credit_note" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "refund_multiplier" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_line" (
    "id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "invoice_line_id" TEXT NOT NULL,
    "quantity_returned" INTEGER NOT NULL,

    CONSTRAINT "credit_note_line_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_line" ADD CONSTRAINT "credit_note_line_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_line" ADD CONSTRAINT "credit_note_line_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
