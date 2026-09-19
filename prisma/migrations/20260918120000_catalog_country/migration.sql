-- Страна происхождения товара — платформенный справочник (без sellerId и ReviewStatus,
-- продавец только выбирает из готового списка). Колонка на catalog nullable, бэкфилла
-- нет: у существующих позиций страна остаётся пустой.

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateTable
CREATE TABLE "country_translations" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_translations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "country_translations_countryId_locale_key"
    ON "country_translations"("countryId", "locale");
CREATE INDEX "country_translations_locale_name_idx"
    ON "country_translations"("locale", "name");
ALTER TABLE "country_translations" ADD CONSTRAINT "country_translations_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "catalog" ADD COLUMN "countryId" TEXT;
CREATE INDEX "catalog_countryId_idx" ON "catalog"("countryId");
ALTER TABLE "catalog" ADD CONSTRAINT "catalog_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
