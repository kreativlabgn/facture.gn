-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('pending', 'active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "MandateGrantedRole" AS ENUM ('accountant_external', 'business_manager');

-- CreateTable
CREATE TABLE "mandate" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'pending',
    "granted_role" "MandateGrantedRole" NOT NULL,
    "permissions_override" JSONB,
    "granted_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mandate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "mandate" ADD CONSTRAINT "mandate_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "professional_practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate" ADD CONSTRAINT "mandate_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate" ADD CONSTRAINT "mandate_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

