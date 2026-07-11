-- Индексы для cursor-пагинации ("load more") и фильтров в списках
-- categories/catalog/listings/sellers.

-- CreateIndex
CREATE INDEX "catalog_categoryId_idx" ON "catalog"("categoryId");

-- CreateIndex
CREATE INDEX "catalog_createdAt_idx" ON "catalog"("createdAt");

-- CreateIndex
CREATE INDEX "categories_createdAt_idx" ON "categories"("createdAt");

-- CreateIndex
CREATE INDEX "listings_catalogItemId_idx" ON "listings"("catalogItemId");

-- CreateIndex
CREATE INDEX "listings_createdAt_idx" ON "listings"("createdAt");

-- CreateIndex
CREATE INDEX "sellers_createdAt_idx" ON "sellers"("createdAt");

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");
