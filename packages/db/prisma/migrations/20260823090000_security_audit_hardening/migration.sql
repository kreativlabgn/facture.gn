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
-- Security Audit 2026-08-23, revue post-fix #3 — contrairement à Payment
-- (idempotencyKey ajouté dès la CREATE TABLE initiale, jamais de ligne
-- existante à concerner), la table refund existe déjà depuis la migration
-- 20260809150541_add_refund. Un ADD COLUMN ... NOT NULL sans DEFAULT échouerait
-- au déploiement dès qu'un seul remboursement existe déjà en base (Postgres
-- rejette un NOT NULL sur une colonne fraîchement ajoutée si des lignes non
-- nulles ne peuvent être garanties). Colonne nullable d'abord, backfill par
-- UUID généré (jamais réutilisable comme vraie clé d'idempotence applicative —
-- ces lignes existantes n'ont jamais eu de clé d'idempotence réelle, seul le
-- besoin ici est de satisfaire la contrainte), puis contrainte NOT NULL posée
-- en dernier.
ALTER TABLE "refund" ADD COLUMN     "idempotency_key" TEXT;

UPDATE "refund" SET "idempotency_key" = gen_random_uuid()::text WHERE "idempotency_key" IS NULL;

ALTER TABLE "refund" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "refund_idempotency_key_key" ON "refund"("idempotency_key");

-- CreateTable (finding #14 — révocation JWT minimale)
CREATE TABLE "revoked_token" (
    "jti" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revoked_token_pkey" PRIMARY KEY ("jti")
);
