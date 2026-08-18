-- AlterEnum
ALTER TYPE "OrganizationRole" ADD VALUE 'developer_api';

-- CreateEnum
CREATE TYPE "ApiKeyEnvironment" AS ENUM ('production', 'sandbox');

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_suffix" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
