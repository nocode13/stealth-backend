-- CreateTable
CREATE TABLE "order_group_status_history" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" "OrderGroupStatus" NOT NULL,
    "comment" TEXT,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_group_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_group_status_history_groupId_idx" ON "order_group_status_history"("groupId");

-- AddForeignKey
ALTER TABLE "order_group_status_history" ADD CONSTRAINT "order_group_status_history_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Бэкфилл берёт историю ПЕРВОГО заказа группы (по createdAt): на проде мультипродавцовая
-- корзина ещё не эксплуатировалась, поэтому у каждой существующей группы фактически ровно
-- один заказ и его история 1:1 совпадает с историей группы. Если где-то (дев/тест) у группы
-- окажется больше одного заказа — намеренно приближение, а не ошибка: берём историю первого,
-- остальные заказы группы в бэкфилл не попадают. OrderStatus и OrderGroupStatus делят
-- одинаковые имена значений (кроме PARTIALLY_DELIVERED, которого тут появиться не может),
-- поэтому каст безопасен. Новые группы бэкфилла не требуют — история пишется вперёд
-- (см. OrdersService.applyStatusTx / createFromCart).
WITH first_order AS (
  SELECT DISTINCT ON (o."groupId") o.id AS "orderId", o."groupId"
  FROM "orders" o
  ORDER BY o."groupId", o."createdAt" ASC, o.id ASC
)
INSERT INTO "order_group_status_history"
  ("id", "groupId", "status", "comment", "changedByUserId", "createdAt")
SELECT
  gen_random_uuid()::text, fo."groupId", h.status::text::"OrderGroupStatus",
  h.comment, h."changedByUserId", h."createdAt"
FROM "order_status_history" h
JOIN first_order fo ON fo."orderId" = h."orderId";
