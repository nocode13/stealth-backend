-- 1. Enum локалей
CREATE TYPE "Locale" AS ENUM ('RU', 'UZ', 'EN');

-- 2. Таблицы переводов
CREATE TABLE "category_translations" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "category_translations_categoryId_locale_key"
    ON "category_translations"("categoryId", "locale");
CREATE INDEX "category_translations_locale_name_idx"
    ON "category_translations"("locale", "name");
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "catalog_item_translations" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_item_translations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_item_translations_catalogItemId_locale_key"
    ON "catalog_item_translations"("catalogItemId", "locale");
CREATE INDEX "catalog_item_translations_locale_name_idx"
    ON "catalog_item_translations"("locale", "name");
ALTER TABLE "catalog_item_translations" ADD CONSTRAINT "catalog_item_translations_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "seller_translations" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_translations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_translations_sellerId_locale_key"
    ON "seller_translations"("sellerId", "locale");
CREATE INDEX "seller_translations_locale_name_idx"
    ON "seller_translations"("locale", "name");
ALTER TABLE "seller_translations" ADD CONSTRAINT "seller_translations_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Бэкфилл. nameKaa намеренно теряется — локаль kaa убрана из продукта.
--    auto = true там, где реального перевода не было (значение скопировано из RU).
INSERT INTO "category_translations" ("id","categoryId","locale","name","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", 'RU'::"Locale", c."nameRu", false, NOW(), NOW() FROM "categories" c;
INSERT INTO "category_translations" ("id","categoryId","locale","name","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", 'UZ'::"Locale",
       COALESCE(NULLIF(c."nameUz", ''), c."nameRu"), (NULLIF(c."nameUz", '') IS NULL), NOW(), NOW()
FROM "categories" c;
INSERT INTO "category_translations" ("id","categoryId","locale","name","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", 'EN'::"Locale",
       COALESCE(NULLIF(c."nameEn", ''), c."nameRu"), (NULLIF(c."nameEn", '') IS NULL), NOW(), NOW()
FROM "categories" c;

INSERT INTO "catalog_item_translations" ("id","catalogItemId","locale","name","description","unit","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, i."id", 'RU'::"Locale", i."name", i."description", i."unit", false, NOW(), NOW() FROM "catalog" i;
INSERT INTO "catalog_item_translations" ("id","catalogItemId","locale","name","description","unit","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, i."id", 'UZ'::"Locale", i."name", i."description", i."unit", true, NOW(), NOW() FROM "catalog" i;
INSERT INTO "catalog_item_translations" ("id","catalogItemId","locale","name","description","unit","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, i."id", 'EN'::"Locale", i."name", i."description", i."unit", true, NOW(), NOW() FROM "catalog" i;

INSERT INTO "seller_translations" ("id","sellerId","locale","name","description","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, s."id", 'RU'::"Locale", s."name", s."description", false, NOW(), NOW() FROM "sellers" s;
INSERT INTO "seller_translations" ("id","sellerId","locale","name","description","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, s."id", 'UZ'::"Locale", s."name", s."description", true, NOW(), NOW() FROM "sellers" s;
INSERT INTO "seller_translations" ("id","sellerId","locale","name","description","auto","createdAt","updatedAt")
SELECT gen_random_uuid()::text, s."id", 'EN'::"Locale", s."name", s."description", true, NOW(), NOW() FROM "sellers" s;

-- 4. Снос старых колонок (только ПОСЛЕ бэкфилла)
ALTER TABLE "categories" DROP COLUMN "nameRu", DROP COLUMN "nameUz",
                         DROP COLUMN "nameEn", DROP COLUMN "nameKaa";
ALTER TABLE "catalog"    DROP COLUMN "name", DROP COLUMN "description", DROP COLUMN "unit";
ALTER TABLE "sellers"    DROP COLUMN "name", DROP COLUMN "description";

-- 5. Снапшот позиции заказа → JSON по локалям
ALTER TABLE "order_items" ALTER COLUMN "unit" DROP DEFAULT;
ALTER TABLE "order_items"
  ALTER COLUMN "catalogItemName" TYPE JSONB
    USING jsonb_build_object('RU', "catalogItemName", 'UZ', "catalogItemName", 'EN', "catalogItemName"),
  ALTER COLUMN "unit" TYPE JSONB
    USING jsonb_build_object('RU', "unit", 'UZ', "unit", 'EN', "unit");

-- 6. Язык уведомлений пользователя
ALTER TABLE "users" ADD COLUMN "locale" "Locale";
