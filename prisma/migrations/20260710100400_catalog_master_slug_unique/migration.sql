-- Partial unique index не описан в schema.prisma (Prisma не умеет декларативно
-- задавать partial-индексы) — защищает master-scope (sellerId IS NULL) от
-- дублей slug, т.к. Postgres не считает NULL = NULL в обычном unique-индексе.
CREATE UNIQUE INDEX "catalog_master_slug_key" ON "catalog"("slug") WHERE "sellerId" IS NULL;
