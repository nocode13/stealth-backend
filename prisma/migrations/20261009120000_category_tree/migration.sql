-- Категории становятся деревом из двух уровней: категория товаров (parentId = null,
-- со стабильным code) → подкатегория. Все существующие категории — роды комнатных
-- растений, поэтому они уходят подкатегориями под новую категорию houseplants.
ALTER TABLE "categories"
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "code" TEXT,
  ADD COLUMN "iconKey" TEXT,
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");
CREATE INDEX "categories_parentId_position_idx" ON "categories"("parentId", "position");

-- Категория товаров «Комнатные растения». id не cuid: в SQL его не сгенерировать, а
-- формат id нигде не проверяется. Сид потом находит её по code и не трогает.
WITH houseplants AS (
  INSERT INTO "categories" ("id", "code", "status", "position", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'houseplants', 'APPROVED', 0, now(), now())
  RETURNING "id"
)
INSERT INTO "category_translations" ("id", "categoryId", "locale", "name", "auto", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, houseplants."id", t."locale"::"Locale", t."name", false, now(), now()
FROM houseplants
CROSS JOIN (VALUES
  ('RU', 'Комнатные растения'),
  ('UZ', 'Xona o''simliklari'),
  ('EN', 'Houseplants')
) AS t("locale", "name");

-- Все нынешние категории (роды) → подкатегории houseplants.
UPDATE "categories"
SET "parentId" = (SELECT "id" FROM "categories" WHERE "code" = 'houseplants')
WHERE "code" IS DISTINCT FROM 'houseplants';

-- Позиция каталога: категория товаров обязательна, подкатегория — бывшая категория (род).
ALTER TABLE "catalog" ADD COLUMN "subcategoryId" TEXT;

ALTER TABLE "catalog"
  ADD CONSTRAINT "catalog_subcategoryId_fkey"
  FOREIGN KEY ("subcategoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "catalog_subcategoryId_idx" ON "catalog"("subcategoryId");

UPDATE "catalog"
SET "subcategoryId" = "categoryId",
    "categoryId" = (SELECT "id" FROM "categories" WHERE "code" = 'houseplants');

ALTER TABLE "catalog" ALTER COLUMN "categoryId" SET NOT NULL;

-- Всё, что накопилось у продавцов, становится общим master-справочником. Статусы не
-- трогаем: PENDING/REJECTED так и остаются на ревью/отклонёнными. Листинги не меняются —
-- у них свой sellerId, а master-позиция доступна любому продавцу. Дубли (один и тот же
-- род или позиция у двух продавцов) здесь не сливаются — это делается руками в админке.
UPDATE "categories" SET "sellerId" = NULL WHERE "sellerId" IS NOT NULL;
UPDATE "catalog" SET "sellerId" = NULL WHERE "sellerId" IS NOT NULL;
