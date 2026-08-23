-- CreateTable
CREATE TABLE "client_portal_otp" (
    "id" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_otp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_portal_otp_msisdn_idx" ON "client_portal_otp"("msisdn");
