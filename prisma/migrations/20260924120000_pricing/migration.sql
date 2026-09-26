-- Ценообразование: себестоимость + денормализованная розница + правила цен.
-- Старый listings.price — то, что видит покупатель, и он НЕ должен измениться: price
-- остаётся розницей, а costPrice выводится из неё обратно через базовую наценку 20%
-- так, чтобы движок (costPrice + 20%, округление вверх до сума) вернул ровно прежнюю цену.

-- CreateEnum
CREATE TYPE "PriceRuleAction" AS ENUM ('MARKUP_PERCENT', 'DISCOUNT_PERCENT', 'FIXED_PRICE');

-- AlterTable: platform_settings
ALTER TABLE "platform_settings"
  ADD COLUMN "markupBps" INTEGER NOT NULL DEFAULT 2000,
  ADD COLUMN "priceRoundingStep" INTEGER NOT NULL DEFAULT 100;

-- AlterTable: listings. price остаётся на месте (розница), индекс (status, price) не
-- трогаем. costPrice = FLOOR(price / 1.2): для цены P, кратной шагу округления (целые
-- сумы), ceil(floor(P / 1.2) * 1.2) лежит в (P - 1.2, P], и округление вверх до 100
-- тийинов даёт ровно P. CEIL здесь увёл бы цену на шаг вверх. bigint — чтобы price * 5
-- не переполнил INTEGER, целочисленное деление округляет вниз.
ALTER TABLE "listings"
  ADD COLUMN "costPrice" INTEGER,
  ADD COLUMN "appliedRuleId" TEXT;
UPDATE "listings" SET "costPrice" = ("price"::BIGINT * 5 / 6)::INTEGER;
ALTER TABLE "listings" ALTER COLUMN "costPrice" SET NOT NULL;
CREATE INDEX "listings_appliedRuleId_idx" ON "listings"("appliedRuleId");

-- AlterTable: orders / order_items. Старые заказы: себестоимость = розница, маржи у
-- них нет — выплаты по ним уже прошли по старой цене, историю не переписываем.
ALTER TABLE "orders" ADD COLUMN "costTotal" INTEGER;
UPDATE "orders" SET "costTotal" = "itemsTotal";
ALTER TABLE "orders" ALTER COLUMN "costTotal" SET NOT NULL;

ALTER TABLE "order_items"
  ADD COLUMN "costPrice" INTEGER,
  ADD COLUMN "costTotal" INTEGER,
  ADD COLUMN "pricing" JSONB;
UPDATE "order_items" SET "costPrice" = "price", "costTotal" = "total";
ALTER TABLE "order_items"
  ALTER COLUMN "costPrice" SET NOT NULL,
  ALTER COLUMN "costTotal" SET NOT NULL;

-- CreateTable
CREATE TABLE "price_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL,
    "action" "PriceRuleAction" NOT NULL,
    "value" INTEGER NOT NULL,
    "sellerId" TEXT,
    "categoryId" TEXT,
    "catalogItemId" TEXT,
    "listingId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "minStock" INTEGER,
    "maxStock" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_rules_enabled_idx" ON "price_rules"("enabled");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_appliedRuleId_fkey" FOREIGN KEY ("appliedRuleId") REFERENCES "price_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
