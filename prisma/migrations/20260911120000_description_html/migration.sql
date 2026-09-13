-- Описания каталога и продавцов теперь HTML из rich-text редактора админки
-- (санитайз — src/common/rich-text.ts). Уже сохранённый plain text переводим в тот же
-- формат, иначе мобилка схлопнула бы его переносы строк в один абзац: экранируем & < >,
-- пустая строка между кусками текста → новый абзац, одиночный перенос → <br>.
-- Значения, уже начинающиеся с '<', считаем HTML и не трогаем — повторный прогон ничего не меняет.
-- ⚠️ После деплоя — INCR sf:ver в Redis: миграция не зовёт cache.bump(), и витрина
-- отдавала бы закэшированный старый текст.

-- 1. Позиции каталога
UPDATE "catalog_item_translations"
SET "description" = '<p>' || regexp_replace(
        regexp_replace(
            replace(replace(replace(replace(
                btrim("description", E' \t\r\n'), E'\r', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
            '\n\s*\n', '</p><p>', 'g'),
        '\n', '<br>', 'g') || '</p>'
WHERE "description" IS NOT NULL
  AND btrim("description", E' \t\r\n') <> ''
  AND btrim("description", E' \t\r\n') NOT LIKE '<%';

-- 2. Продавцы
UPDATE "seller_translations"
SET "description" = '<p>' || regexp_replace(
        regexp_replace(
            replace(replace(replace(replace(
                btrim("description", E' \t\r\n'), E'\r', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
            '\n\s*\n', '</p><p>', 'g'),
        '\n', '<br>', 'g') || '</p>'
WHERE "description" IS NOT NULL
  AND btrim("description", E' \t\r\n') <> ''
  AND btrim("description", E' \t\r\n') NOT LIKE '<%';
