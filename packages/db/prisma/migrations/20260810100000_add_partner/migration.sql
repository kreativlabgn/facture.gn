-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('apip', 'fodip', 'partner_3ae');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('active', 'suspended', 'expired');

-- CreateTable
CREATE TABLE "partner" (
    "id" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "name" TEXT NOT NULL,
    "convention_ref" TEXT,
    "status" "PartnerStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);
