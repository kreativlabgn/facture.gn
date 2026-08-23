-- Security Audit 2026-08-23 — findings #1, #2, #8, #13, #14 (voir ReportFindings
-- de l'audit sécurité, session du 2026-08-23).

-- CreateEnum
CREATE TYPE "PublicBuyerAccountVerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

-- AlterTable (finding #1 — un PublicBuyerAccount démarre non vérifié)
ALTER TABLE "public_buyer_account" ADD COLUMN     "verification_status" "PublicBuyerAccountVerificationStatus" NOT NULL DEFAULT 'pending';

-- AlterTable (finding #13 — un lien customer<->public_buyer_account n'est plus
-- confirmé par défaut, doit être confirmé explicitement par le compte acheteur ciblé)
ALTER TABLE "customer" ADD COLUMN     "is_public_entity_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (finding #8 — AssistedSession gagne une expiration et une révocation)
ALTER TABLE "assisted_session" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "revoked_at" TIMESTAMP(3);

-- AlterTable (finding #2 — refunds idempotents, même pattern que payment.idempotency_key)
ALTER TABLE "refund" ADD COLUMN     "idempotency_key" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "refund_idempotency_key_key" ON "refund"("idempotency_key");

-- CreateTable (finding #14 — révocation JWT minimale)
CREATE TABLE "revoked_token" (
    "jti" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revoked_token_pkey" PRIMARY KEY ("jti")
);
