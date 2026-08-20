-- CreateEnum
CREATE TYPE "CommissionBypassLevel" AS ENUM ('none', 'level_1_nudged', 'level_2_proof_threshold_lowered', 'level_3_under_review', 'level_4_restricted');

-- CreateEnum
CREATE TYPE "CommissionBypassCaseStatus" AS ENUM ('pending', 'dismissed', 'restricted');

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "commission_bypass_level" "CommissionBypassLevel" NOT NULL DEFAULT 'none',
ADD COLUMN     "commission_bypass_proof_threshold_override_gnf" BIGINT;

-- CreateTable
CREATE TABLE "commission_bypass_case" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "CommissionBypassCaseStatus" NOT NULL DEFAULT 'pending',
    "detected_patterns" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "commission_bypass_case_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "commission_bypass_case" ADD CONSTRAINT "commission_bypass_case_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
