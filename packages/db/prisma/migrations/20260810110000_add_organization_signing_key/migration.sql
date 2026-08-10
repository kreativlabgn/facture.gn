-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "signing_key_id" TEXT;

-- CreateTable
CREATE TABLE "organization_signing_key" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "encrypted_private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_signing_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_signing_key_organization_id_key" ON "organization_signing_key"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_signing_key" ADD CONSTRAINT "organization_signing_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_signing_key_id_fkey" FOREIGN KEY ("signing_key_id") REFERENCES "organization_signing_key"("id") ON DELETE SET NULL ON UPDATE CASCADE;
