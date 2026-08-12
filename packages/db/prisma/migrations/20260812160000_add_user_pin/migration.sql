-- AlterTable
ALTER TABLE "user" ADD COLUMN     "pin_hash" TEXT,
ADD COLUMN     "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin_locked_until" TIMESTAMP(3);
