-- Переход на целые тиины (1 сум = 100 тиинов) и удаление поля currency
-- (валюта всегда одна, отдельного enum/поля не нужно).

ALTER TABLE "listings" ALTER COLUMN "price" TYPE INTEGER USING ROUND("price" * 100)::int;
ALTER TABLE "listings" DROP COLUMN "currency";

ALTER TABLE "orders" ALTER COLUMN "itemsTotal" TYPE INTEGER USING ROUND("itemsTotal" * 100)::int;
ALTER TABLE "orders" ALTER COLUMN "deliveryFee" TYPE INTEGER USING ROUND("deliveryFee" * 100)::int;
ALTER TABLE "orders" ALTER COLUMN "deliveryFee" SET DEFAULT 0;
ALTER TABLE "orders" ALTER COLUMN "total" TYPE INTEGER USING ROUND("total" * 100)::int;
ALTER TABLE "orders" DROP COLUMN "currency";

ALTER TABLE "order_items" ALTER COLUMN "price" TYPE INTEGER USING ROUND("price" * 100)::int;
ALTER TABLE "order_items" ALTER COLUMN "total" TYPE INTEGER USING ROUND("total" * 100)::int;
