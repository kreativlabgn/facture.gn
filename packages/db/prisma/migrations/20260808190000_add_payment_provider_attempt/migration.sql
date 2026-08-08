-- CreateEnum
CREATE TYPE "PaymentProviderName" AS ENUM ('djomy', 'moneroo', 'orange_direct', 'mtn_direct');

-- CreateEnum
CREATE TYPE "PaymentProviderAttemptStatus" AS ENUM ('pending', 'success', 'failed', 'timeout');

-- CreateTable
CREATE TABLE "payment_provider_attempt" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "provider" "PaymentProviderName" NOT NULL,
    "status" "PaymentProviderAttemptStatus" NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT,
    "amount_gnf" BIGINT NOT NULL,
    "fee_gateway" BIGINT NOT NULL DEFAULT 0,
    "fee_platform" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "payment_provider_attempt_pkey" PRIMARY KEY ("id")
);
