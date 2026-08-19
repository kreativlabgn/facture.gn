-- CreateEnum
CREATE TYPE "RevenueShareCreditStatus" AS ENUM ('pending', 'paid');

-- CreateTable
CREATE TABLE "revenue_share_credit" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_month" TEXT NOT NULL,
    "gross_commission_centimes" BIGINT NOT NULL,
    "credited_amount_centimes" BIGINT NOT NULL,
    "status" "RevenueShareCreditStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_share_credit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revenue_share_credit_practice_id_organization_id_period_mo_key" ON "revenue_share_credit"("practice_id", "organization_id", "period_month");

-- AddForeignKey
ALTER TABLE "revenue_share_credit" ADD CONSTRAINT "revenue_share_credit_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "professional_practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_share_credit" ADD CONSTRAINT "revenue_share_credit_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
