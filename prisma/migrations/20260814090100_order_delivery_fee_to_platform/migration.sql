-- Доставка стала платформенной и считается один раз на чекаут (order_groups.deliveryFee).
-- На заказе продавца её доли нет, а total без неё дублировал itemsTotal.
ALTER TABLE "orders" DROP COLUMN "deliveryFee";
ALTER TABLE "orders" DROP COLUMN "total";
