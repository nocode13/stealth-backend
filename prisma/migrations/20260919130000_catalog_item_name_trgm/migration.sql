-- Fuzzy-поиск по названию позиции каталога (word_similarity, см. ListingsService).
-- Индекс не используется текущим функциональным вызовом напрямую (word_similarity()
-- как функция, не оператор `%`/`<%`), но нужен под рост каталога и возможный переход
-- на operator-based запрос без новой миграции.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "catalog_item_translations_name_trgm_idx"
  ON "catalog_item_translations" USING GIN ("name" gin_trgm_ops);
