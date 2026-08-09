-- CreateEnum
CREATE TYPE "ProfessionalPracticeType" AS ENUM ('cabinet_comptable', 'gestionnaire', 'fiduciaire', 'cga');

-- CreateEnum
CREATE TYPE "ProfessionalPracticeTier" AS ENUM ('partner_free', 'partner_starter', 'partner_pro', 'partner_institutional');

-- CreateEnum
CREATE TYPE "PracticeMemberRole" AS ENUM ('practice_admin', 'accountant_external', 'business_manager');

-- CreateTable
CREATE TABLE "professional_practice" (
    "id" TEXT NOT NULL,
    "type" "ProfessionalPracticeType" NOT NULL,
    "name" TEXT NOT NULL,
    "registration_number" TEXT,
    "ordre_verified" BOOLEAN NOT NULL DEFAULT false,
    "tier" "ProfessionalPracticeTier" NOT NULL DEFAULT 'partner_free',
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_member" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "PracticeMemberRole" NOT NULL,
    "permissions_override" JSONB,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "practice_member_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "practice_member" ADD CONSTRAINT "practice_member_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "professional_practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_member" ADD CONSTRAINT "practice_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

