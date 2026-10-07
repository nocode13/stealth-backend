-- Код продавца у листинга: необязательный, вводится руками ради поиска в админке.
-- Уникален в пределах продавца; NULL в unique-индексе Postgres различны, поэтому
-- позиции без кода друг другу не мешают.
ALTER TABLE "listings" ADD COLUMN "sku" TEXT;

CREATE UNIQUE INDEX "listings_sellerId_sku_key" ON "listings"("sellerId", "sku");
