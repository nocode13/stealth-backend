-- Индекс под сортировку витрины по цене (sort=price_asc / price_desc).
-- Композитный, потому что where витрины всегда содержит status = 'ACTIVE'.
CREATE INDEX "listings_status_price_idx" ON "listings"("status", "price");
