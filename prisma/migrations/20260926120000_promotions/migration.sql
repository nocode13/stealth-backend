-- Акции: кампания (promotions) + переводы + явный список листингов (promotion_items).
-- На listings — денормализованный результат движка по акции (пишет только
-- PricingService): oldPrice/promotionId/onPromo. Бэкфилл не нужен: до первой акции
-- ни один листинг на ней не стоит, дефолты это и описывают.

-- AlterTable
ALTER TABLE "listings"
  ADD COLUMN "oldPrice" INTEGER,
  ADD COLUMN "promotionId" TEXT,
  ADD COLUMN "onPromo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "discountBps" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_translations" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_items" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "discountBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_promotionId_idx" ON "listings"("promotionId");
CREATE INDEX "promotions_enabled_idx" ON "promotions"("enabled");
CREATE INDEX "promotions_createdAt_idx" ON "promotions"("createdAt");
CREATE UNIQUE INDEX "promotion_translations_promotionId_locale_key" ON "promotion_translations"("promotionId", "locale");
CREATE INDEX "promotion_items_listingId_idx" ON "promotion_items"("listingId");
CREATE UNIQUE INDEX "promotion_items_promotionId_listingId_key" ON "promotion_items"("promotionId", "listingId");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotion_translations" ADD CONSTRAINT "promotion_translations_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
