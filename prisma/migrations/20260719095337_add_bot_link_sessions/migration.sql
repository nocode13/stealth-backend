-- CreateEnum
CREATE TYPE "BotSessionPurpose" AS ENUM ('DELIVERY_LOCATION', 'SELLER_LINK');

-- CreateTable
CREATE TABLE "bot_link_sessions" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "purpose" "BotSessionPurpose" NOT NULL,
    "userId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_link_sessions_nonce_key" ON "bot_link_sessions"("nonce");

-- CreateIndex
CREATE INDEX "bot_link_sessions_userId_idx" ON "bot_link_sessions"("userId");

-- CreateIndex
CREATE INDEX "bot_link_sessions_expiresAt_idx" ON "bot_link_sessions"("expiresAt");
