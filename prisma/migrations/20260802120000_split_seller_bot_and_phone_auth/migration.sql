-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffTelegramId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_staffTelegramId_key" ON "users"("staffTelegramId");

-- Разводим ботов: telegramId остаётся адресом покупателя в основном боте,
-- а привязка staff'а переезжает в staffTelegramId (бот продавца).
UPDATE "users"
SET "staffTelegramId" = "telegramId", "telegramId" = NULL
WHERE "role" IN ('SELLER', 'SUPER_ADMIN') AND "telegramId" IS NOT NULL;

-- CreateTable
CREATE TABLE "phone_auth_sessions" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT,
    "telegramId" TEXT,
    "userId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "mismatch" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_auth_sessions_nonce_key" ON "phone_auth_sessions"("nonce");

-- CreateIndex
CREATE INDEX "phone_auth_sessions_phone_idx" ON "phone_auth_sessions"("phone");

-- CreateIndex
CREATE INDEX "phone_auth_sessions_telegramId_idx" ON "phone_auth_sessions"("telegramId");

-- CreateIndex
CREATE INDEX "phone_auth_sessions_expiresAt_idx" ON "phone_auth_sessions"("expiresAt");
