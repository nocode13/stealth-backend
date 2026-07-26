-- Слаг у позиции каталога не использовался ни витриной, ни админкой: позиция всегда
-- адресуется по id. Вместе с колонкой уходят оба уникальных индекса — обычный
-- (sellerId, slug) и partial по master-scope из 20260710100400_catalog_master_slug_unique.
DROP INDEX IF EXISTS "catalog_master_slug_key";

DROP INDEX IF EXISTS "catalog_sellerId_slug_key";

ALTER TABLE "catalog" DROP COLUMN "slug";
