-- ADR-063, C13 — "credit_note = document comptable. refund = mouvement d'argent."
-- payment_link_payout (Djomy Payout) reste sans exécution automatique dans ce repo
-- (V2, ADR-089) — status "pending" est un état durable pour cette valeur de method,
-- pas transitoire, aucune tâche planifiée ne le fait progresser aujourd'hui.

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('cash', 'payment_link_payout', 'bank_transfer', 'credit_on_account');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "provider_ref" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
