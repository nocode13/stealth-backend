-- OrderGroup: общие данные чекаута (контакты, адрес, оплата, итог) переезжают из
-- Order в отдельную таблицу — одна запись на чекаут вместо N копий (по одной на
-- продавца). orders."groupId" был обычной строкой без FK; теперь это настоящий FK
-- на order_groups.id. Бэкфилл использует существующие значения groupId как id
-- новых групп, поэтому строки orders не апдейтятся вообще.

-- CreateEnum
CREATE TYPE "OrderGroupStatus" AS ENUM ('NEW', 'CONFIRMED', 'ASSEMBLING', 'DELIVERING', 'ARRIVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "order_groups" (
    "id" TEXT NOT NULL,
    "groupNumber" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderGroupStatus" NOT NULL DEFAULT 'NEW',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "deliveryComment" TEXT,
    "deliveryLat" DOUBLE PRECISION,
    "deliveryLng" DOUBLE PRECISION,
    "savedAddressId" TEXT,
    "itemsTotal" INTEGER NOT NULL,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_groups_groupNumber_key" ON "order_groups"("groupNumber");

-- CreateIndex
CREATE INDEX "order_groups_userId_createdAt_idx" ON "order_groups"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "order_groups_status_idx" ON "order_groups"("status");

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_savedAddressId_fkey" FOREIGN KEY ("savedAddressId") REFERENCES "saved_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Бэкфилл: id группы = существующий orders."groupId", поэтому строки orders не
-- трогаем. Порядок CASE тот же, что в deriveGroupStatus() (src/orders/order-status.ts) —
-- карта одна на двоих, расхождение читалось бы как баг. На проде все заказы одного
-- продавца, поэтому агрегаты берут единственную строку; SQL написан на общий случай
-- сознательно, для будущих мультипродавцовых групп.
INSERT INTO "order_groups" (
  id, "userId", status, "paymentMethod", "paymentStatus",
  "contactName", "contactPhone", "deliveryAddress", "deliveryComment",
  "deliveryLat", "deliveryLng", "savedAddressId",
  "itemsTotal", "deliveryFee", total, "createdAt", "updatedAt"
)
SELECT
  o."groupId",
  (array_agg(o."userId"))[1],
  CASE
    WHEN bool_and(o.status = 'CANCELLED') THEN 'CANCELLED'
    WHEN bool_and(o.status = 'DELIVERED') THEN 'DELIVERED'
    WHEN bool_and(o.status IN ('DELIVERED','CANCELLED'))
         AND bool_or(o.status = 'DELIVERED') THEN 'PARTIALLY_DELIVERED'
    WHEN bool_or(o.status = 'DELIVERED') THEN 'PARTIALLY_DELIVERED'
    WHEN bool_or(o.status = 'NEW') THEN 'NEW'
    WHEN bool_or(o.status = 'CONFIRMED') THEN 'CONFIRMED'
    WHEN bool_or(o.status = 'ASSEMBLING') THEN 'ASSEMBLING'
    WHEN bool_or(o.status = 'DELIVERING') THEN 'DELIVERING'
    ELSE 'ARRIVED'
  END::"OrderGroupStatus",
  (array_agg(o."paymentMethod"))[1], (array_agg(o."paymentStatus"))[1],
  (array_agg(o."contactName"))[1],   (array_agg(o."contactPhone"))[1],
  (array_agg(o."deliveryAddress"))[1], (array_agg(o."deliveryComment"))[1],
  (array_agg(o."deliveryLat"))[1],   (array_agg(o."deliveryLng"))[1],
  (array_agg(o."savedAddressId"))[1],
  SUM(o."itemsTotal"), 0, SUM(o.total),
  MIN(o."createdAt"), MAX(o."updatedAt")
FROM (SELECT * FROM "orders" ORDER BY "createdAt", id) o
GROUP BY o."groupId";

-- Раздать groupNumber по хронологии и подвинуть счётчик за максимум.
WITH n AS (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn FROM "order_groups")
UPDATE "order_groups" g SET "groupNumber" = n.rn FROM n WHERE n.id = g.id;

SELECT setval('"order_groups_groupNumber_seq"', COALESCE((SELECT MAX("groupNumber") FROM "order_groups"), 0) + 1, false);

-- AddForeignKey: orders.groupId становится настоящим FK на order_groups.
ALTER TABLE "orders" ADD CONSTRAINT "orders_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropForeignKey: FK на saved_addresses и колонки-снапшот переезжают на order_groups,
-- в orders их больше нет. Выполняется строго последним шагом, после того как данные
-- уже лежат в order_groups.
ALTER TABLE "orders" DROP CONSTRAINT "orders_savedAddressId_fkey";

-- AlterTable
ALTER TABLE "orders"
  DROP COLUMN "paymentMethod",
  DROP COLUMN "paymentStatus",
  DROP COLUMN "contactName",
  DROP COLUMN "contactPhone",
  DROP COLUMN "deliveryAddress",
  DROP COLUMN "deliveryComment",
  DROP COLUMN "deliveryLat",
  DROP COLUMN "deliveryLng",
  DROP COLUMN "savedAddressId";
