-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "account_code" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "is_field_agent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "assisted_session" (
    "id" TEXT NOT NULL,
    "field_agent_user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "consent_recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assisted_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_account_code_key" ON "organization"("account_code");

-- AddForeignKey
ALTER TABLE "assisted_session" ADD CONSTRAINT "assisted_session_field_agent_user_id_fkey" FOREIGN KEY ("field_agent_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assisted_session" ADD CONSTRAINT "assisted_session_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
