/*
  Warnings:

  - You are about to drop the `otp_codes` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "name" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

-- DropTable
DROP TABLE "otp_codes";

-- DropEnum
DROP TYPE "OtpChannel";

-- CreateTable
CREATE TABLE "telegram_auth_sessions" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "telegramId" TEXT,
    "userId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_auth_sessions_nonce_key" ON "telegram_auth_sessions"("nonce");

-- CreateIndex
CREATE INDEX "telegram_auth_sessions_expiresAt_idx" ON "telegram_auth_sessions"("expiresAt");
