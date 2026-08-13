-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- Переименование, а не drop/create: существующие фото обязаны пережить переезд.
-- Индексы и FK-констрейнты переименовываются следом, чтобы имена в БД совпадали
-- с тем, что сгенерирует Prisma для таблицы catalog_item_media.
ALTER TABLE "catalog_item_images" RENAME TO "catalog_item_media";
ALTER TABLE "catalog_item_media" RENAME CONSTRAINT "catalog_item_images_pkey" TO "catalog_item_media_pkey";
ALTER TABLE "catalog_item_media" RENAME CONSTRAINT "catalog_item_images_catalogItemId_fkey" TO "catalog_item_media_catalogItemId_fkey";
ALTER INDEX "catalog_item_images_catalogItemId_idx" RENAME TO "catalog_item_media_catalogItemId_idx";

-- AlterTable: всё, что уже лежит в таблице, — готовые фото
ALTER TABLE "catalog_item_media"
  ADD COLUMN "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
  ADD COLUMN "status" "MediaStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "posterUrl" TEXT;

-- CreateIndex
CREATE INDEX "catalog_item_media_status_idx" ON "catalog_item_media"("status");
