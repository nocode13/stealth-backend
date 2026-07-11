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
- **Passport** — аутентификация: JWT+refresh и OTP (мобилка), session (админка).
- **nodemailer** — отправка email (Gmail SMTP) для OTP-канала EMAIL.
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

Сид-пользователи (пароль у всех `password123`, у каждого есть `phone`):
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
  otp/             # OtpService + подключаемые каналы доставки кода (channels/)
  users/           # UsersService (поиск/создание/привязка контактов/пароль)
  sellers/         # SellersService (продавцы = арендаторы)
  categories/      # CategoriesService — категории (master + предложенные продавцом)
  catalog/         # CatalogService — справочник цветов (master + предложенный продавцом)
  listings/        # ListingsService — предложения продавца + остаток
  storage/         # StorageService — S3-совместимое хранилище (фото каталога)
  admin/           # API-поверхность админки (session-guard'ы)
  mobile/          # API-поверхность мобилки (JWT-guard'ы)
```

### Доменная модель (`prisma/schema.prisma`)

- **User** — `phone` (**обязательный, unique** — якорь личности), `email?`/`telegramId?`
  (nullable unique, привязываются при OTP через свой канал), `passwordHash?` (nullable — у
  OTP-юзеров пароля нет), `role` (`SUPER_ADMIN | SELLER | CUSTOMER`), опциональный `sellerId`.
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
- **OtpCode** — одноразовые коды входа: `phone` (аккаунт), `channel`, `destination`,
  `codeHash` (sha256), `expiresAt`, `consumedAt?`, `attempts`. Enum `OtpChannel { SMS EMAIL TELEGRAM }`.

## Аутентификация (две стратегии)

### Мобилка — JWT (Bearer), access + refresh
- `POST /mobile/auth/register` (phone+password, email опц.) / `login` (email+password)
  → `{ accessToken, refreshToken }`.
- Access-токен (короткий TTL) в заголовке `Authorization: Bearer`. Защита —
  `JwtAuthGuard` (`JwtStrategy`, секрет `JWT_ACCESS_SECRET`).
- `POST /mobile/auth/refresh` — ротация: старый refresh гасится, выдаётся новая
  пара. В БД хранится `sha256` от refresh-токена; в payload — `jti` для
  уникальности. `POST /mobile/auth/logout` отзывает refresh.

### Мобилка — OTP (phone-first, passwordless)
- Флоу: `POST /mobile/auth/otp/request` `{ phone, channel, email?/telegramId? }` →
  `POST /mobile/auth/otp/verify` `{ phone, channel, code }` → `{ accessToken, refreshToken }`.
- **Телефон — обязательный якорь.** find-or-create по `phone` (`AuthService.loginWithOtp`).
  Канал (`SMS | EMAIL | TELEGRAM`) — только куда доставить код. При verify через email/telegram
  контакт привязывается к юзеру (`UsersService.linkContact`).
- `email` в запросе обязателен только при `channel=EMAIL`, `telegramId` — при `TELEGRAM`
  (`@ValidateIf` в `otp/dto/otp.dto.ts`).
- Правила (`OtpService`): код 6 цифр, TTL 300с, в БД только `sha256(code)`; resend-cooldown 60с;
  ≥5 неверных попыток гасят код. Параметры — env `OTP_*`.
- **Подключаемые каналы** (паттерн «стратегия»): интерфейс `OtpDeliverySender`
  (`otp/channels/otp-sender.interface.ts`), реализации регистрируются в `OtpModule` под
  DI-токеном `OTP_SENDERS`, `OtpDeliveryRegistry` выбирает по каналу.
  - `EmailOtpSender` — **реальный** Gmail SMTP (nodemailer). Без SMTP-кредов в dev код падает в лог.
  - `SmsOtpSender`, `TelegramOtpSender` — **заглушки**: пишут код в лог. Чтобы подключить
    реальные — заменить тело `send()` (Telegram: Bot API по `telegram.botToken`; SMS: провайдер
    по `sms.provider`/`sms.apiKey`), остальной код не трогается. Точки помечены `TODO`.

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
