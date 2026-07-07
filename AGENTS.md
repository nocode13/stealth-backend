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
  - Схема ведётся через **миграции** (`prisma migrate`). Начальная миграция `0_init`
    забаселайнена (помечена applied) на существующей БД. Файлы миграций коммитятся в git.
- **Passport** — аутентификация: JWT+refresh и OTP (мобилка), session (админка).
- **nodemailer** — отправка email (Gmail SMTP) для OTP-канала EMAIL.
- **@nestjs/swagger** — две отдельные спеки.

## Как запустить

```bash
pnpm install
cp .env.example .env          # секреты уже с дефолтами для локалки
pnpm db:up                    # поднять Postgres в docker
pnpm db:migrate               # применить миграции (prisma migrate dev)
pnpm db:seed                  # засидить админа, продавца, справочник
pnpm start:dev                # запуск с watch
```

На деплое схему накатывает `pnpm db:deploy` (`prisma migrate deploy`) — применяет только
новые миграции, ничего не удаляя.

- Swagger: `http://localhost:3000/docs/admin` и `/docs/mobile`.
- Health: `GET /health`.
- Adminer (UI для БД): `http://localhost:8080` (сервер `postgres`, БД/юзер/пароль `stealth`).

Сид-пользователи (пароль у всех `password123`, у каждого есть `phone`):
- `admin@stealth.local` / `+998900000001` — `SUPER_ADMIN` (справочник и продавцы);
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
  catalog/         # CatalogService — справочник цветов (глобальный мастер-список)
  listings/        # ListingsService — предложения продавца + остаток
  admin/           # API-поверхность админки (session-guard'ы)
  mobile/          # API-поверхность мобилки (JWT-guard'ы)
```

### Доменная модель (`prisma/schema.prisma`)

- **User** — `phone` (**обязательный, unique** — якорь личности), `email?`/`telegramId?`
  (nullable unique, привязываются при OTP через свой канал), `passwordHash?` (nullable — у
  OTP-юзеров пароля нет), `role` (`SUPER_ADMIN | SELLER | CUSTOMER`), опциональный `sellerId`.
- **Seller** — продавец (арендатор). Пока одна запись, но модель мультипродавца.
- **CatalogItem** — **справочник цветов**: глобальный мастер-список, из которого
  продавцы создают листинги. Управляется `SUPER_ADMIN`. Так новые продавцы
  выбирают из общего справочника, а не плодят дубликаты.
- **Listing** — предложение продавца поверх позиции справочника: `price`,
  `currency`, `stock` (инвентарь), `status`. Уникальность `(sellerId, catalogItemId)`.
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
- `SUPER_ADMIN` — справочник (`/admin/catalog`), продавцы (`/admin/sellers`);
- `SELLER` — свои листинги (`/admin/listings`, sellerId берётся из пользователя);
- `CUSTOMER` — витрина мобилки.

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
ротации → 401; `SELLER` пишет в справочник → 403; сессии появляются в таблице
`session` Postgres.

> `AGENTS.md` — копия этого файла. При изменениях правьте оба (или синхронизируйте).
