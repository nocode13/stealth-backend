-- Листинг становится вариантом товара: у продавца по одной позиции каталога их может
-- быть несколько. Уникальность набора атрибутов проверяет ListingsService.
DROP INDEX "listings_sellerId_catalogItemId_key";
CREATE INDEX "listings_sellerId_catalogItemId_idx" ON "listings"("sellerId", "catalogItemId");

-- Атрибуты варианта. Все существующие листинги — «без атрибутов».
ALTER TABLE "listings"
  ADD COLUMN "seedling" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "potVolumeMl" INTEGER,
  ADD COLUMN "stemCount" INTEGER,
  ADD COLUMN "heightCm" INTEGER;

CREATE INDEX "listings_seedling_idx" ON "listings"("seedling");

-- Своя галерея варианта — в той же таблице, что и галерея каталога: видео-воркер
-- работает по id строки и не должен знать, чья это галерея.
ALTER TABLE "catalog_item_media"
  ALTER COLUMN "catalogItemId" DROP NOT NULL,
  ADD COLUMN "listingId" TEXT;

ALTER TABLE "catalog_item_media"
  ADD CONSTRAINT "catalog_item_media_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "catalog_item_media_listingId_idx" ON "catalog_item_media"("listingId");

-- Владелец строки ровно один. Prisma CHECK не выражает и при diff его не видит,
-- поэтому drift он не даёт.
ALTER TABLE "catalog_item_media"
  ADD CONSTRAINT "catalog_item_media_single_owner"
  CHECK (("catalogItemId" IS NULL) <> ("listingId" IS NULL));

-- Снапшот атрибутов варианта в позиции заказа.
ALTER TABLE "order_items" ADD COLUMN "variant" JSONB;
