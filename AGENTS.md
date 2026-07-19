# Stealth Backend — платформа продажи цветов

Backend (NestJS) для платформы продажи цветов и инвентаря. Часть системы из трёх
приложений: **мобилка** (покупатели), **админка** (продавец/платформа) и этот
**backend** (отдельный репозиторий). MVP: пока один продавец, но архитектура
рассчитана на мультипродавца (marketplace).

## Стек

- **NestJS 11** + TypeScript (`module: nodenext`), пакетный менеджер **pnpm**.
- **PostgreSQL 16** в Docker (`docker-compose.yml`).
- **Prisma 6** — ORM (`prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`).
  - ⚠️ Намеренно зафиксирована v6: Prisma 7 требует driver-адаптеры и
    `prisma.config.ts`. Не апгрейдить до v7 без миграции конфига.
  - Схема ведётся через **миграции** (`prisma migrate`). Файлы миграций коммитятся в git.
  - ⚠️ `prisma migrate dev` детектит drift из-за таблицы `session` (создаётся
    `connect-pg-simple` вне Prisma, см. «Аутентификация»). Если он просит `migrate reset`,
    не соглашайтесь на нём вслепую (потеря данных) — либо пишите миграцию руками
    и накатывайте через `prisma migrate deploy`, либо временно убирайте `session`
    из БД перед генерацией.
- **Passport** — аутентификация: JWT+refresh (мобилка), session (админка).
- **grammy** — Telegram-бот: единственный способ входа в мобилку (`src/telegram/`).
- **MinIO** (S3-совместимое хранилище, `docker-compose.yml`) — фото каталога,
  через `@aws-sdk/client-s3` (`src/storage/`). На проде — тот же код, другой S3-провайдер.
- **@nestjs/swagger** — две отдельные спеки.

## Как запустить

```bash
pnpm install
cp .env.example .env          # секреты уже с дефолтами для локалки
pnpm db:up                    # поднять Postgres + MinIO в docker
pnpm db:migrate               # применить миграции (prisma migrate dev)
pnpm db:seed                  # засидить админа, продавца, категории, справочник
pnpm start:dev                # запуск с watch
```

На деплое схему накатывает `pnpm db:deploy` (`prisma migrate deploy`) — применяет только
новые миграции, ничего не удаляя.

- Swagger: `http://localhost:3000/docs/admin` и `/docs/mobile`.
- Health: `GET /health`.
- Adminer (UI для БД): `http://localhost:8080` (сервер `postgres`, БД/юзер/пароль `stealth`).
- MinIO: S3 API `http://localhost:9000`, консоль `http://localhost:9001`
  (`stealth`/`stealth123`), бакет `catalog` создаётся автоматически (`minio-init`
  в `docker-compose.yml`, публичное чтение).

Сид-пользователи админки (пароль у всех `password123`, `phone` заполнен — но у юзеров
мобилки его может не быть, вход туда идёт по `telegramId`):
- `admin@stealth.local` / `+998900000001` — `SUPER_ADMIN` (справочник, категории, продавцы);
- `seller@stealth.local` / `+998900000002` — `SELLER` (владелец «Первый цветочный»).

## Скрипты

| Скрипт | Действие |
|--------|----------|
| `pnpm start:dev` | запуск с watch |
| `pnpm build` | сборка (`nest build`, prisma исключена из компиляции) |
| `pnpm db:up` / `db:down` | поднять/остановить Postgres |
| `pnpm db:migrate` | создать+применить миграцию в dev (`prisma migrate dev`) |
| `pnpm db:deploy` | применить миграции на проде (`prisma migrate deploy`) |
| `pnpm db:seed` | наполнить БД |
| `pnpm db:studio` | Prisma Studio |
| `pnpm prisma:generate` | перегенерировать Prisma Client (после правки схемы) |

## Архитектура модулей

Разделение на **доменные модули** (бизнес-логика + доступ к БД) и
**API-поверхности** (тонкие контроллеры со своими guard'ами и Swagger-тегами).
Логика в поверхностях не дублируется — только вызовы доменных сервисов.

```
src/
  config/          # @nestjs/config + валидация env (Joi)
  prisma/          # @Global PrismaModule + PrismaService
  common/          # @Roles(), @CurrentUser(), RolesGuard
  auth/            # AuthService, стратегии, guard'ы (см. «Аутентификация»)
  telegram/        # Бот (grammy), сессии входа по nonce, валидация Mini App initData
  users/           # UsersService (поиск/создание/профиль/пароль)
  sellers/         # SellersService (продавцы = арендаторы)
  categories/      # CategoriesService — категории (master + предложенные продавцом)
  catalog/         # CatalogService — справочник цветов (master + предложенный продавцом)
  listings/        # ListingsService — предложения продавца + остаток
  storage/         # StorageService — S3-совместимое хранилище (фото каталога)
  admin/           # API-поверхность админки (session-guard'ы)
  mobile/          # API-поверхность мобилки (JWT-guard'ы)
```

### Доменная модель (`prisma/schema.prisma`)

- **User** — `telegramId?` (nullable unique) — **якорь личности мобилки**: вход только через
  Telegram-бота. `phone?`/`email?` (nullable unique) и `name?` — **опциональные профильные
  поля**, юзер дозаполняет их сам через `PATCH /mobile/auth/me`; обязательными станут на этапе
  заказов (модели `Order` пока нет). `passwordHash?` (nullable — есть только у админов),
  `role` (`SUPER_ADMIN | SELLER | CUSTOMER`), опциональный `sellerId`.
- **Seller** — продавец (арендатор). Пока одна запись, но модель мультипродавца.
- **Category** и **CatalogItem** — общий паттерн владения/ревью:
  - `sellerId = null` → **master**-запись, создаёт только `SUPER_ADMIN`, сразу `status: APPROVED`.
  - `sellerId` заполнен → продавец предложил свою (категорию или позицию каталога),
    уходит в `status: PENDING` до апрува `SUPER_ADMIN`'ом (`PATCH …/:id/status`).
    После апрува видна и доступна **только этому продавцу** (наряду с master),
    остальным продавцам — не видна и недоступна для выбора/листинга.
  - На витрине мобилки (`/mobile/categories`, `/mobile/catalog`, `/mobile/listings`)
    видны **все** `APPROVED`-записи независимо от `sellerId` — ограничение
    «видно только этому продавцу» касается **создания/выбора**, не показа покупателю.
  - `Category` — мультиязычные названия `nameRu` (обязательное, фолбэк), `nameUz?/nameEn?/nameKaa?`.
  - `CatalogItem` — `categoryId` (связь с `Category`), `imageUrl` (S3-ссылка, см.
    `POST /admin/catalog/:id/image`), `slug` уникален в рамках `sellerId`
    (партиционный unique-индекс защищает master-scope, `sellerId IS NULL`, от дублей —
    Prisma не умеет декларировать partial-индексы, он есть только в SQL миграции).
  - Общий enum `ReviewStatus { PENDING APPROVED REJECTED }`.
- **Listing** — предложение продавца поверх позиции справочника: `price`,
  `currency`, `stock` (инвентарь), `status`. Уникальность `(sellerId, catalogItemId)`.
  При создании листинга `ListingsService` проверяет через `CatalogService.assertUsable`,
  что `catalogItemId` одобрен и виден продавцу (master `APPROVED` либо его собственный).
- **RefreshToken** — хэши активных refresh-токенов мобилки (для ротации/отзыва).
- **TelegramAuthSession** — короткоживущая сессия входа: `nonce` (unique), `telegramId?`/`userId?`
  (проставляет бот на `/start`), `consumedAt?`, `expiresAt`. Токены в ней **не хранятся** —
  при консьюме выпускается свежая пара, поэтому в таблице нет секретов.

## Аутентификация (две стратегии)

### Мобилка — JWT (Bearer), access + refresh
- Access-токен (короткий TTL) в заголовке `Authorization: Bearer`. Защита —
  `JwtAuthGuard` (`JwtStrategy`, секрет `JWT_ACCESS_SECRET`).
- **Payload access-токена узкий** — только `sub`/`role`/`sellerId` (тип `AuthPrincipal`):
  профильные поля редактируемые, и держать их в токене значило бы отдавать устаревшие
  значения после `PATCH /me`. Поэтому `GET /mobile/auth/me` **читает БД**, а не claims,
  и полный профиль (`AuthUser`) существует только как ответ `/me` и в сессии админки.
- `POST /mobile/auth/refresh` — ротация: старый refresh гасится, выдаётся новая
  пара. В БД хранится `sha256` от refresh-токена; в payload — `jti` для
  уникальности. `POST /mobile/auth/logout` отзывает refresh.

### Мобилка — вход только через Telegram
**OTP полностью удалён** (модуль `src/otp/`, каналы доставки, `OtpCode`, `OtpChannel`, nodemailer).
Единственный вход — Telegram-бот, он же регистрация: юзер заводится по `telegramId`.

Два пути, оба ведут к `AuthService.issueTokens`:

1. **Нативка/веб — nonce + polling** (`TelegramAuthService`):
   - `POST /mobile/auth/telegram/session` → `{ nonce, botUrl, expiresIn }`,
     `botUrl = https://t.me/<TELEGRAM_BOT_USERNAME>?start=<nonce>`.
   - Бот ловит `/start <nonce>` → `confirm()` привязывает `telegramId`/`userId` к сессии.
   - `GET /mobile/auth/telegram/session/:nonce` → `pending` | `expired` | `confirmed` + токены.
     Токены выдаются **ровно один раз**: `consumedAt` ставится условным `updateMany`
     (`where consumedAt: null`), поэтому гонка двух поллеров не выдаст две пары.
2. **Mini App — `initData`**: `POST /mobile/auth/telegram/miniapp` `{ initData }`.
   Подпись проверяется вручную на `node:crypto` (`secret = HMAC("WebAppData", botToken)`,
   сверка с `hash`, `auth_date` не старше TTL) — библиотека для 15 строк не нужна.

- **Бот** (`TelegramBotService`, grammy): `TELEGRAM_USE_WEBHOOK=false` → long-polling (dev, без
  публичного URL); `true` → `setWebhook` + `TelegramWebhookController` (`POST /telegram/webhook`,
  без гварда, сверяет заголовок `x-telegram-bot-api-secret-token`; скрыт из Swagger через
  `@ApiExcludeController`). Пустой `TELEGRAM_BOT_TOKEN` → приложение поднимается, бот не стартует
  (warning в лог), вход недоступен.
- `PATCH /mobile/auth/me` — `{ name?, phone?, email? }`, все опциональны, пустая строка очищает
  поле. Занятые `phone`/`email` → **409** (`UsersService.updateProfile` ловит `P2002` и разбирает
  `e.meta.target`, чтобы сказать, какое поле конфликтует).
- Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_USE_WEBHOOK`,
  `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`, `TG_AUTH_SESSION_TTL_SECONDS`.

### Админка — Session (httpOnly cookie)
- `POST /admin/auth/login` (`LocalStrategy`, email+password) → passport-сессия,
  cookie `connect.sid` (`httpOnly`, `sameSite=lax`, `secure` в prod).
- Хранилище сессий — **Postgres** через `connect-pg-simple` (таблица `session`
  создаётся автоматически, вне Prisma). Настройка в `src/main.ts`.
- Защита роутов — `AuthenticatedGuard` (`req.isAuthenticated()`). Сессия
  сериализует только `userId`, пользователь подтягивается в `SessionSerializer`.
- `GET /admin/auth/me`, `POST /admin/auth/logout`.

### Авторизация по ролям
`RolesGuard` + `@Roles(...)` (ставить ПОСЛЕ guard'а аутентификации):
- `SUPER_ADMIN` — категории и справочник (`/admin/categories`, `/admin/catalog`) без
  ограничений, апрув/реджект чужих предложений (`PATCH …/:id/status`), продавцы (`/admin/sellers`);
- `SELLER` — тоже имеет доступ к `/admin/categories` и `/admin/catalog` (создание
  своих + просмотр master `APPROVED`), но `PATCH …/:id/status` — только `SUPER_ADMIN`
  (переопределяется на уровне хендлера через `@Roles` — `getAllAndOverride` берёт
  роли хендлера, а не класса). Свои листинги — `/admin/listings`
  (sellerId берётся из пользователя);
- `CUSTOMER` — витрина мобилки.

### Хранилище фото (`src/storage/`)
- `StorageService` — S3-совместимый клиент (`@aws-sdk/client-s3`, `forcePathStyle: true`).
  Локально — **MinIO** (`docker-compose.yml`, бакет `catalog`, публичное чтение).
  На проде меняются только env (`S3_*`), код не трогаем.
- `POST /admin/catalog/:id/image` (multipart, поле `file`, `FileInterceptor` с
  `memoryStorage`, лимит 5MB, только `image/*`) — загружает в S3 и обновляет
  `CatalogItem.imageUrl`. Владелец-проверка: `SELLER` может грузить фото только
  для своих позиций.

## Конвенции

- DTO — классы с `class-validator` + `@ApiProperty`. Глобальный `ValidationPipe`
  (`whitelist`, `transform`, `forbidNonWhitelisted`) — лишние поля отклоняются.
- Новый домен: `*.service.ts` (Prisma внутри) + `*.module.ts` (экспорт сервиса),
  контроллеры — в `admin/` и/или `mobile/`, а не в доменном модуле.
- Типы из `@prisma/client`, используемые в **декорированных сигнатурах**
  (`@CurrentUser() u: AuthUser`), импортировать через `import type`
  (`isolatedModules` + `emitDecoratorMetadata`).
- После правки `schema.prisma`: `pnpm db:migrate` (создаёт миграцию в `prisma/migrations/`
  + генерит клиент). Миграции коммитим в git; на проде — `pnpm db:deploy`.
- `prisma/` исключена из `nest build` (`tsconfig.build.json`), иначе сдвигается
  `dist/` (main оказывается в `dist/src/`).

## Проверка изменений

Мобильный флоу и админский session-флоу проверяются curl'ом (см. README/историю
коммитов). Ключевые инварианты: витрина без токена → 401; старый refresh после
ротации → 401; сессии появляются в таблице `session` Postgres; `SELLER`, создавая
категорию/позицию каталога, получает `status: PENDING`, а `SUPER_ADMIN` — сразу
`APPROVED`; второй `SELLER` не видит и не может использовать чужую кастомную
категорию/позицию (403 при попытке сослаться на чужой `categoryId`/`catalogItemId`
в листинге).

> `AGENTS.md` — копия этого файла. При изменениях правьте оба (или синхронизируйте).
