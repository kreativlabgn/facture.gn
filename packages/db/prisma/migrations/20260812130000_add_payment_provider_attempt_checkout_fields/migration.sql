-- AlterTable
ALTER TABLE "payment_provider_attempt" ADD COLUMN     "payment_link_url" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3);
