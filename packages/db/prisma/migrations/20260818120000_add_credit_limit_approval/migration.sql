-- AlterEnum
ALTER TYPE "OrganizationRole" ADD VALUE 'approver';

-- AlterTable
ALTER TABLE "organization" ADD COLUMN "credit_limit_approval_threshold" BIGINT;

-- CreateEnum
CREATE TYPE "CreditLimitChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "credit_limit_change_request" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "current_limit" BIGINT,
    "requested_limit" BIGINT NOT NULL,
    "status" "CreditLimitChangeStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,

    CONSTRAINT "credit_limit_change_request_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "credit_limit_change_request" ADD CONSTRAINT "credit_limit_change_request_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_change_request" ADD CONSTRAINT "credit_limit_change_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_change_request" ADD CONSTRAINT "credit_limit_change_request_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_change_request" ADD CONSTRAINT "credit_limit_change_request_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
