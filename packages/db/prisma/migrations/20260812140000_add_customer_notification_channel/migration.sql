-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('sms', 'whatsapp', 'both');

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "notification_channel" "NotificationChannel" NOT NULL DEFAULT 'sms';
