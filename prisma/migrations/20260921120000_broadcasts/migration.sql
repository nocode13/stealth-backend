-- CreateEnum
CREATE TYPE "BroadcastAudience" AS ENUM ('ALL', 'SELECTED');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('SENDING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BROADCAST';

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "buttonText" JSONB,
    "buttonUrl" TEXT,
    "sendPush" BOOLEAN NOT NULL,
    "sendTelegram" BOOLEAN NOT NULL,
    "audience" "BroadcastAudience" NOT NULL,
    "recipientIds" TEXT[],
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SENDING',
    "recipientsCount" INTEGER NOT NULL DEFAULT 0,
    "pushSent" INTEGER NOT NULL DEFAULT 0,
    "pushFailed" INTEGER NOT NULL DEFAULT 0,
    "tgSent" INTEGER NOT NULL DEFAULT 0,
    "tgFailed" INTEGER NOT NULL DEFAULT 0,
    "tgBlocked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcasts_createdAt_idx" ON "broadcasts"("createdAt");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
