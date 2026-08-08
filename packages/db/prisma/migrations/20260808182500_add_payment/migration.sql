-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'payment_link', 'bank_transfer');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "amount_collected" BIGINT NOT NULL,
    "platform_fee_amount" BIGINT NOT NULL DEFAULT 0,
    "gateway_fee_amount" BIGINT NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "provider_sub_method" TEXT,
    "deposit_type" TEXT,
    "provider_ref" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "idempotency_key" TEXT NOT NULL,
    "proof_photo_url" TEXT,
    "proof_gps_lat" DOUBLE PRECISION,
    "proof_gps_lng" DOUBLE PRECISION,
    "proof_signature" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotency_key_key" ON "payment"("idempotency_key");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
