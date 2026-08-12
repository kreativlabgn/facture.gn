-- CreateTable
CREATE TABLE "ussd_session" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'root',
    "context_data" JSONB,
    "user_id" TEXT,
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ussd_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ussd_session_session_id_key" ON "ussd_session"("session_id");
