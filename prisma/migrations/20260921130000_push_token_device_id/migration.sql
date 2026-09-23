-- AlterTable
ALTER TABLE "push_tokens" ADD COLUMN "deviceId" TEXT;

-- CreateIndex
CREATE INDEX "push_tokens_deviceId_idx" ON "push_tokens"("deviceId");
