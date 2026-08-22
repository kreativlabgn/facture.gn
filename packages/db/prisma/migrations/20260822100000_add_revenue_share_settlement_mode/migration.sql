-- CreateEnum
CREATE TYPE "RevenueShareSettlementMode" AS ENUM ('payout', 'subscription_deduction');

-- AlterTable
ALTER TABLE "professional_practice" ADD COLUMN "revenue_share_settlement_mode" "RevenueShareSettlementMode" NOT NULL DEFAULT 'payout';
