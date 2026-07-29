-- Адрес доставки теперь берётся из пикера карты (Yandex MapKit/ymaps3) в мобилке,
-- а не из Telegram-бота — DELIVERY_LOCATION-сессии и координаты в них больше не пишутся.
-- Живых сессий с этим purpose не остаётся дольше ttl (300с), но на всякий случай чистим
-- перед изменением типа: ALTER TYPE ... USING упадёт на значении, которого нет в новом enum.
DELETE FROM "bot_link_sessions" WHERE "purpose" = 'DELIVERY_LOCATION';

-- DropColumn
ALTER TABLE "bot_link_sessions" DROP COLUMN "latitude";
ALTER TABLE "bot_link_sessions" DROP COLUMN "longitude";

-- AlterEnum (Postgres не поддерживает DROP VALUE напрямую — пересоздаём тип)
BEGIN;
CREATE TYPE "BotSessionPurpose_new" AS ENUM ('SELLER_LINK');
ALTER TABLE "bot_link_sessions" ALTER COLUMN "purpose" TYPE "BotSessionPurpose_new" USING ("purpose"::text::"BotSessionPurpose_new");
ALTER TYPE "BotSessionPurpose" RENAME TO "BotSessionPurpose_old";
ALTER TYPE "BotSessionPurpose_new" RENAME TO "BotSessionPurpose";
DROP TYPE "BotSessionPurpose_old";
COMMIT;
