-- Версии приложения в сторах: мобилка спрашивает их у GET /mobile/app-version и решает,
-- показывать ли плашку «обновитесь» (latestVersion) или блокирующий экран
-- (minSupportedVersion). Правит SUPER_ADMIN из админки, без редеплоя.

-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "app_versions" (
  "platform" "AppPlatform" NOT NULL,
  "latestVersion" TEXT NOT NULL,
  "minSupportedVersion" TEXT NOT NULL,
  "storeUrl" TEXT NOT NULL,
  "releaseNotesRu" TEXT,
  "releaseNotesUz" TEXT,
  "releaseNotesEn" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "app_versions_pkey" PRIMARY KEY ("platform")
);

-- Обе строки заводим сразу, как синглтон platform_settings: сервис умеет отдавать
-- «обновлений нет» на отсутствующей строке, но пустая таблица на проде читается как
-- «настройки потеряли», а не «их ещё не трогали».
--
-- minSupportedVersion = 1.0.0 намеренно: до первой публикации в App Store ссылка на
-- iOS-карточку — плейсхолдер, и любое другое значение заблокировало бы пользователей
-- кнопкой, ведущей в никуда. Реальные значения проставляются из админки.
INSERT INTO "app_versions" ("platform", "latestVersion", "minSupportedVersion", "storeUrl", "updatedAt")
VALUES
  ('ANDROID', '1.0.21', '1.0.0', 'https://play.google.com/store/apps/details?id=uz.egen.marketplace', NOW()),
  ('IOS', '1.0.21', '1.0.0', 'https://apps.apple.com/app/id0000000000', NOW());
