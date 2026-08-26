-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_auth_sessions" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_auth_sessions_nonce_key" ON "email_auth_sessions"("nonce");

-- CreateIndex
CREATE INDEX "email_auth_sessions_email_idx" ON "email_auth_sessions"("email");

-- CreateIndex
CREATE INDEX "email_auth_sessions_expiresAt_idx" ON "email_auth_sessions"("expiresAt");

-- DropTable
DROP TABLE "phone_auth_sessions";
