-- CreateEnum
CREATE TYPE "WebhookNormalizedStatus" AS ENUM ('paid', 'failed', 'pending');

-- CreateTable
CREATE TABLE "payment_webhook" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProviderName" NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "normalized_status" "WebhookNormalizedStatus" NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_provider_provider_ref_key" ON "payment_webhook"("provider", "provider_ref");
