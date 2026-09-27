-- Ступенчатая базовая наценка, своя наценка листинга, фиксированная цена в акциях и
-- порядок источников цены вместо скрытых правил. Витрина после миграции должна дать
-- те же цены: одна ступень с прежней наценкой, акции — с прежней акционной ценой,
-- наценочные правила переезжают в свою наценку листинга. Цены листингов под
-- DISCOUNT_PERCENT/FIXED_PRICE-правилами вернутся к базовой наценке при первом
-- пересчёте (PricingScheduler делает полный пересчёт при старте).

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('PROMOTION', 'LISTING_MARKUP', 'BASE_MARKUP');

-- CreateTable: ступени базовой наценки. Первая — с 0 и прежней наценкой.
CREATE TABLE "markup_tiers" (
    "id" TEXT NOT NULL,
    "minCost" INTEGER NOT NULL,
    "markupBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markup_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "markup_tiers_minCost_key" ON "markup_tiers"("minCost");

INSERT INTO "markup_tiers" ("id", "minCost", "markupBps", "updatedAt")
SELECT 'default', 0, COALESCE((SELECT "markupBps" FROM "platform_settings" WHERE "id" = 'default'), 2000), CURRENT_TIMESTAMP;

ALTER TABLE "platform_settings" DROP COLUMN "markupBps";

-- CreateTable: порядок источников цены (по умолчанию акция → своя → базовая).
CREATE TABLE "price_priorities" (
    "source" "PriceSource" NOT NULL,
    "position" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_priorities_pkey" PRIMARY KEY ("source")
);
CREATE UNIQUE INDEX "price_priorities_position_key" ON "price_priorities"("position");

INSERT INTO "price_priorities" ("source", "position", "updatedAt") VALUES
  ('PROMOTION', 0, CURRENT_TIMESTAMP),
  ('LISTING_MARKUP', 1, CURRENT_TIMESTAMP),
  ('BASE_MARKUP', 2, CURRENT_TIMESTAMP);

-- AlterTable: listings — своя наценка и источник цены вместо правила.
ALTER TABLE "listings"
  ADD COLUMN "customMarkupBps" INTEGER,
  ADD COLUMN "priceSource" "PriceSource" NOT NULL DEFAULT 'BASE_MARKUP';

-- Листинг, который сейчас стоит по наценочному правилу, сохраняет эту наценку своей.
UPDATE "listings" AS l
SET "customMarkupBps" = r."value"
FROM "price_rules" AS r
WHERE l."appliedRuleId" = r."id" AND r."action" = 'MARKUP_PERCENT';

UPDATE "listings" SET "priceSource" = 'LISTING_MARKUP' WHERE "customMarkupBps" IS NOT NULL;
UPDATE "listings" SET "priceSource" = 'PROMOTION' WHERE "promotionId" IS NOT NULL;

-- AlterTable: promotion_items — фиксированная цена вместо скидки. Бэкфилл повторяет
-- прежний движок: скидка от обычной розницы, вверх до шага округления, не ниже
-- себестоимости. Обычная розница — oldPrice, если листинг сейчас на акции, иначе price.
ALTER TABLE "promotion_items" ADD COLUMN "promoPrice" INTEGER;

UPDATE "promotion_items" AS pi
SET "promoPrice" = GREATEST(
  (CEIL(
    COALESCE(l."oldPrice", l."price")::NUMERIC
      * (10000 - COALESCE(pi."discountBps", p."discountBps"))
      / 10000
      / s."priceRoundingStep"
  ) * s."priceRoundingStep")::INTEGER,
  l."costPrice"
)
FROM "promotions" AS p, "listings" AS l, "platform_settings" AS s
WHERE pi."promotionId" = p."id" AND pi."listingId" = l."id" AND s."id" = 'default';

-- Без строки настроек (не должно случаться) — шаг 100, как дефолт колонки.
UPDATE "promotion_items" AS pi
SET "promoPrice" = GREATEST(
  (CEIL(
    COALESCE(l."oldPrice", l."price")::NUMERIC
      * (10000 - COALESCE(pi."discountBps", p."discountBps"))
      / 10000
      / 100
  ) * 100)::INTEGER,
  l."costPrice"
)
FROM "promotions" AS p, "listings" AS l
WHERE pi."promotionId" = p."id" AND pi."listingId" = l."id" AND pi."promoPrice" IS NULL;

ALTER TABLE "promotion_items"
  ALTER COLUMN "promoPrice" SET NOT NULL,
  DROP COLUMN "discountBps";

ALTER TABLE "promotions" DROP COLUMN "discountBps";

-- DropTable: правила цены.
ALTER TABLE "listings" DROP CONSTRAINT "listings_appliedRuleId_fkey";
DROP INDEX "listings_appliedRuleId_idx";
ALTER TABLE "listings" DROP COLUMN "appliedRuleId";

DROP TABLE "price_rules";
DROP TYPE "PriceRuleAction";
