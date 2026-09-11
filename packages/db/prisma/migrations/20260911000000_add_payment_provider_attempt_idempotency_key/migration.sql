-- Clé d'idempotence des tentatives de paiement (money-api, provider-registry).
-- Nullable : les attempts historiques n'en portent pas ; l'index sert au
-- rejeu d'un même `${invoiceId}:${provider}` sans doublon d'attempt.

-- AlterTable
ALTER TABLE "payment_provider_attempt" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE INDEX "payment_provider_attempt_idempotency_key_idx" ON "payment_provider_attempt"("idempotency_key");
