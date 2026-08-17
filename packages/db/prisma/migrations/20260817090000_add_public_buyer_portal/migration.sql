-- AlterEnum
ALTER TYPE "InvoiceEventType" ADD VALUE 'liquidation_validated';

-- CreateEnum
CREATE TYPE "PublicBuyerAccountMemberRole" AS ENUM ('public_buyer_validator');

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "is_public_entity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "public_buyer_account_id" TEXT;

-- CreateTable
CREATE TABLE "public_buyer_account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_buyer_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_buyer_account_member" (
    "id" TEXT NOT NULL,
    "public_buyer_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "PublicBuyerAccountMemberRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_buyer_account_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Un seul public_buyer_account par utilisateur en V1 (invariant applicatif,
-- rendu infranchissable ici y compris sous concurrence).
CREATE UNIQUE INDEX "public_buyer_account_member_user_id_key" ON "public_buyer_account_member"("user_id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_public_buyer_account_id_fkey" FOREIGN KEY ("public_buyer_account_id") REFERENCES "public_buyer_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_buyer_account_member" ADD CONSTRAINT "public_buyer_account_member_public_buyer_account_id_fkey" FOREIGN KEY ("public_buyer_account_id") REFERENCES "public_buyer_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_buyer_account_member" ADD CONSTRAINT "public_buyer_account_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
