-- CreateEnum
CREATE TYPE "BranchType" AS ENUM ('boutique', 'entrepot', 'agence', 'en_ligne');

-- CreateTable
CREATE TABLE "branch" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BranchType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
