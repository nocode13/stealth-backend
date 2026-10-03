-- Артикул листинга: короткий номер для ссылок (app.egen.uz/l/<code>) и поиска.
-- Последовательность своя и начинается с 10001, чтобы артикул сразу был 5-значным;
-- существующие листинги получают номера из неё же при добавлении колонки.
CREATE SEQUENCE "listings_code_seq" START WITH 10001;

ALTER TABLE "listings" ADD COLUMN "code" INTEGER NOT NULL DEFAULT nextval('"listings_code_seq"');

ALTER SEQUENCE "listings_code_seq" OWNED BY "listings"."code";

CREATE UNIQUE INDEX "listings_code_key" ON "listings"("code");
