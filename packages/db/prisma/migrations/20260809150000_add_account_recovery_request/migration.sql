-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "account_recovery_request" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,

    CONSTRAINT "account_recovery_request_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "account_recovery_request" ADD CONSTRAINT "account_recovery_request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recovery_request" ADD CONSTRAINT "account_recovery_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recovery_request" ADD CONSTRAINT "account_recovery_request_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
