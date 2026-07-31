-- CreateTable
CREATE TABLE "catalog_item_images" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_item_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_item_images_catalogItemId_idx" ON "catalog_item_images"("catalogItemId");

-- AddForeignKey
ALTER TABLE "catalog_item_images" ADD CONSTRAINT "catalog_item_images_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: перенести существующее одиночное imageUrl в галерею как первое фото
INSERT INTO "catalog_item_images" ("id", "catalogItemId", "url", "sortOrder", "createdAt")
SELECT gen_random_uuid()::text, "id", "imageUrl", 0, now()
FROM "catalog"
WHERE "imageUrl" IS NOT NULL;

-- DropColumn
ALTER TABLE "catalog" DROP COLUMN "imageUrl";
