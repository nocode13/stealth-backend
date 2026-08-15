-- Платформенная доставка: один тариф на всю платформу вместо доставки per-заказ,
-- плюс вайтлист позиций с бесплатной доставкой независимо от порога.

-- CreateTable
CREATE TABLE "platform_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "deliveryFee" INTEGER NOT NULL DEFAULT 0,
  "freeDeliveryThreshold" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
-- Синглтон заводим сразу: сервис умеет создать строку лениво, но пустая таблица на проде
-- читается как «настройки потеряли», а не «их ещё не трогали».
INSERT INTO "platform_settings" ("id", "updatedAt") VALUES ('default', NOW());

-- Вайтлист бесплатной доставки — флаг на позиции каталога.
ALTER TABLE "catalog" ADD COLUMN "freeDelivery" BOOLEAN NOT NULL DEFAULT false;
