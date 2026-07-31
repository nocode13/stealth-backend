# Stealth Backend — платформа продажи цветов

Backend (NestJS) для платформы продажи цветов и инвентаря. Система из трёх приложений:
**мобилка** (покупатели, живёт как Telegram Mini App), **админка** (продавец/платформа) и этот
**backend** (отдельный репозиторий). MVP — один продавец, модель данных мультипродавцовая.

## Стек

NestJS 11 + TypeScript (`module: nodenext`), Node ≥22, pnpm · PostgreSQL 16 + **Prisma 6**
(⚠️ v6 зафиксирована: Prisma 7 требует driver-адаптеры и `prisma.config.ts`) · Redis
(`ioredis`, опционален) · Passport (JWT+refresh для мобилки, session для админки) · grammy
(бот — единственный вход в мобилку) · S3 (`@aws-sdk/client-s3`) + `sharp` — MinIO локально,
Cloudflare R2 на проде · `@nestjs/swagger` (две спеки) · `@nestjs/config` + Joi
(`src/config/configuration.ts`).

## Запуск

```bash
pnpm install && cp .env.example .env   # дефолты для локалки проставлены
pnpm db:up                             # ⚠️ только postgres + minio; redis поднимать вручную
pnpm db:migrate && pnpm db:seed
pnpm start:dev
```

Swagger `/docs/admin` и `/docs/mobile`, health `GET /health`, Adminer `:8080` (всё `stealth`),
MinIO-консоль `:9001` (`stealth`/`stealth123`, бакет `catalog` создаёт `minio-init`, чтение
публичное). Полный список переменных — в `.env.example` (с комментариями), обязательность и
дефолты — в Joi-схеме. Сид создаёт **только супер-админа** `admin@stealth.local` / `+998900000001`
(пароль из `SEED_ADMIN_PASSWORD`, дефолт `password123`) — демо-данных нет намеренно, чтобы
сид можно было гонять на проде. Всё остальное заводится через админку.

| Скрипт | Действие |
|--------|----------|
| `start:dev` / `build` / `start:prod` | watch / `prisma generate && nest build` / прод |
| `start:railway` | `prisma migrate deploy && node dist/main` |
| `db:up` / `db:down` / `db:studio` | docker-инфраструктура / Prisma Studio |
| `db:migrate` / `db:deploy` / `db:seed` | миграция в dev / на проде / сид |
| `prisma:generate` | перегенерировать клиент после правки схемы |
| `lint` / `format` | eslint --fix (`eslint.config.mjs`) / prettier |
| `test`, `test:watch`, `test:cov`, `test:e2e` | jest — см. «Проверка изменений»: тестов нет |
| `tunnel` / `tunnel:minio` | cloudflared на 3000 / 9000 (webhook бота и фото в dev) |

⚠️ `prisma migrate dev` детектит drift из-за таблицы `session` (её создаёт `connect-pg-simple`
вне Prisma). На предложение `migrate reset` не соглашаться вслепую — потеря данных: либо
писать миграцию руками и накатывать `prisma migrate deploy`, либо временно удалить `session`
из БД. Миграции коммитятся в git.

## Архитектура

**Доменные модули** (бизнес-логика + Prisma) отдельно от **API-поверхностей** (тонкие
контроллеры со своими guard'ами и Swagger-тегами). Логика в поверхностях не дублируется.
Новый домен = `*.service.ts` + `*.module.ts`, контроллеры — в `admin/`/`mobile/`.

```
src/
  config/ prisma/          # env+Joi · @Global PrismaModule
  cache/                   # @Global CacheService (Redis, витрина)
  common/                  # @Roles, @CurrentUser, RolesGuard, курсорная пагинация,
                           # telegram-identity.ts («один Telegram = одна роль»)
  auth/                    # стратегии и guard'ы: JWT / session / local
  users/ sellers/ categories/ catalog/ listings/ cart/ addresses/
  orders/                  # OrdersService, order-status.ts, order-notifier.service.ts
  notifications/ metrics/  # in-app лента · агрегаты для дашборда админки
  storage/                 # StorageService (S3) + ImageService (sharp → webp)
  telegram/                # бот: bootstrap + композеры + исходящие
  admin/ mobile/           # API-поверхности (+ admin/upload.options.ts)
```

## Доменная модель (`prisma/schema.prisma`)

**Сущность без собственных полей не заводится**: нет обёртки `Cart` над `CartItem` (корзина у
юзера неявно одна), нет модели `Checkout` — заказы одного оформления связывает `groupId`.

- **User** — `telegramId?` (nullable unique) — **якорь личности мобилки**. `phone?`/`email?`
  (nullable unique) и `name?` — опциональные, юзер дозаполняет через `PATCH /mobile/auth/me`;
  обязательны только в checkout (уходят в снапшот заказа, телефон дописывается в профиль,
  P2002 молча пропускается). `passwordHash?` только у админов, `role`, `sellerId?`.
- **Seller** — арендатор: `name`, `description?`, `bannerUrl?`, `status`, `ownerUserId`.
- **Category** / **CatalogItem** — общий паттерн владения и ревью:
  `sellerId = null` → **master**, создаёт только `SUPER_ADMIN`, сразу `APPROVED`;
  `sellerId` заполнен → продавец предложил свою, `PENDING` до апрува (`PATCH …/:id/status`).
  После апрува доступна для выбора/листинга **только этому продавцу** (наряду с master), но
  на витрине мобилки видны **все** `APPROVED` — ограничение касается создания, не показа.
  `Category`: `nameRu` (обязательное, фолбэк) + `nameUz?/nameEn?/nameKaa?`.
  `CatalogItem`: `categoryId?` (nullable, `Restrict`), `unit` (дефолт «шт»), галерея
  `images: CatalogItemImage[]`. Общий enum `ReviewStatus`.
- **Listing** — предложение продавца поверх позиции: `price`, `stock`, `status`
  (`DRAFT|ACTIVE|ARCHIVED`), `@@unique([sellerId, catalogItemId])`. При создании
  `CatalogService.assertUsable` проверяет, что позиция одобрена и видна этому продавцу.
- **Деньги — `Int` в тийинах** (1 сум = 100 тийин), колонки валюты нет.
- **RefreshToken** — sha256-хэши активных refresh-токенов.
- **TelegramAuthSession** — вход по nonce; токенов в ней нет (при консьюме выпускается свежая
  пара), поэтому в таблице нет секретов. **BotLinkSession** — «сходить в бота и вернуться»
  для уже известного юзера, `purpose` сейчас только `SELLER_LINK`, TTL 300 с.
- **SavedAddress** — адресная книга (`label?`, `address`, `comment?`, `lat?/lng?`).
- **Notification** — in-app лента. **Order / OrderItem / OrderStatusHistory** — см. «Заказы»;
  `orderNumber` autoincrement, по нему ищут в админке.

**Снапшоты, а не FK.** `OrderItem` копирует имя, обложку, единицу и цену; `Order` — контакты,
адрес и деньги. Листинг может подорожать, уехать в `ARCHIVED` или удалиться (`listingId` →
`null`), `SavedAddress` — измениться, но оформленный заказ обязан остаться читаемым.
`savedAddressId` (`SetNull`) хранится только ради трейсинга.

## API

Глобального префикса нет. **Админка** — везде `AuthenticatedGuard + RolesGuard`, кроме `auth`:

| Роут | Роли | Эндпоинты |
|---|---|---|
| `admin/auth` | — | `POST login` (LocalAuthGuard), `POST logout`, `GET me`, `POST telegram/link`, `POST telegram/unlink` |
| `admin/categories` | SUPER_ADMIN, SELLER | CRUD + `PATCH /:id/status` — **только SUPER_ADMIN** (`@Roles` на хендлере перебивает класс) |
| `admin/catalog` | SUPER_ADMIN, SELLER | CRUD + `POST /:id/images`, `DELETE /:id/images/:imageId`, `PATCH /:id/images/:imageId/reorder` |
| `admin/listings` | SELLER, SUPER_ADMIN | CRUD, `sellerId` из пользователя |
| `admin/orders` | SELLER, SUPER_ADMIN | `GET /` (фильтр `status`, поиск по номеру/телефону/имени), `GET /:id`, `PATCH /:id/status`, `PATCH /:id/courier` |
| `admin/sellers` | SUPER_ADMIN | CRUD + `POST /:id/image` (баннер) |
| `admin/metrics` | SUPER_ADMIN | `GET users`, `GET orders`, `GET catalog`, `GET overview` |

`SELLER` жёстко скоупится своим `sellerId`; его query-параметр `sellerId` игнорируется.

**Мобилка.** Optional-auth в проекте нет — доступ бинарный, на уровне контроллера.

| Роут | Guard | Эндпоинты |
|---|---|---|
| `mobile/auth` | JwtAuthGuard только на `me`/`logout` | `POST telegram/session`, `GET telegram/session/:nonce`, `POST telegram/miniapp`, `POST refresh`, `GET/PATCH me`, `POST logout` |
| `mobile/listings`, `mobile/categories`, `mobile/sellers/:id` | **публичные** | витрина; сервис жёстко фильтрует (`ACTIVE`+`stock>0`, `APPROVED`, `ACTIVE`) и игнорирует `status` из query |
| `mobile/catalog` | JwtAuthGuard | `GET /` — ⚠️ асимметрия: остальная витрина публичная |
| `mobile/cart` | JwtAuthGuard | `GET /`, `POST items`, `PATCH/DELETE items/:id`, `DELETE /` |
| `mobile/addresses` | JwtAuthGuard | CRUD, всё scoped по `userId` |
| `mobile/orders` | JwtAuthGuard | `POST /`, `GET /`, `GET /:id`, `POST /:id/cancel` |
| `mobile/notifications` | JwtAuthGuard | `GET /`, `POST read` |

Плюс `GET /health` и `POST /telegram/webhook` (без гварда, сверяет заголовок
`x-telegram-bot-api-secret-token`, скрыт из Swagger `@ApiExcludeController`).

**Метрики** — счётчики юзеров/заказов/каталога и `overview`; `from`/`to` включительно, оба
необязательны (нет = за всё время), кэша нет. ⚠️ «Сегодня» считается по UTC, не по Ташкенту;
`revenue` исключает `CANCELLED`, а `byStatus` — нет, поэтому суммы не сходятся by design.

## Заказы

**Один checkout = N заказов.** Корзина может содержать листинги разных продавцов, поэтому
`createFromCart` режет её по `sellerId`: каждому свой `Order` со своим статусом, все связаны
`groupId` (`randomUUID`).

**Гонка за остатком.** Списание — условным апдейтом внутри транзакции:
`updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })`,
`count === 0` роняет транзакцию. Проверка *до* транзакции нужна лишь ради понятной ошибки с
названием товара. Отмена возвращает остаток (`increment`) там же. Тот же приём — claim сессии
в `TelegramAuthService.poll`.

**Статусы — `src/orders/order-status.ts`.** `ALLOWED_TRANSITIONS` — **единственный источник
правды**: из неё валидируется `PATCH /admin/orders/:id/status`, строятся inline-кнопки бота и
селект в админке. Дублировать нельзя. Там же подписи статусов/кнопок и тексты покупателю.

```
NEW → CONFIRMED → ASSEMBLING → DELIVERING → ARRIVED → DELIVERED
        (из любого нетерминального) → CANCELLED
```

Из `DELIVERING` можно закрыть сразу в `DELIVERED`. `ARRIVED` («курьер на месте») существует
ради уведомления «выходите». Покупатель отменяет сам только из `NEW`/`CONFIRMED`.

**Доставка.** Либо `savedAddressId` (тогда сырые поля игнорируются, принадлежность проверяет
`AddressesService.findOwned`), либо сырые поля — и в этой ветке `deliveryLat`/`deliveryLng`
**обязательны**: точку даёт Яндекс-пикер на клиенте, гео-API на бэкенде нет. Флаг
`saveAddress` (только с сырыми полями) кладёт `SavedAddress` в ту же `$transaction`. Адрес
резолвится **один раз на весь checkout** и копируется во все N заказов. Курьеру уходит текст +
нативная карточка локации Telegram — у неё встроенная кнопка «Маршрут» в Яндекс/Google Картах.
Модели курьера нет: `courierName`/`courierPhone` — задел, продавец пересылает карточку сам
(пересылка сохраняет геоточку).

**Деньги.** `deliveryFee` всегда `0` и нигде не считается (тарифов нет), `total = itemsTotal`.
Оплата только `CASH`, поэтому `paymentMethod` в `CreateOrderDto` отсутствует. Payme/Click —
добавлением значений в енам; `providerTxnId`/`providerPayload` нет намеренно: у провайдера на
заказ бывает несколько попыток, это будущая модель `Payment`.

**После коммита**, в этом порядке: `cache.bump()` → бэкфилл телефона/имени → уведомление продавцу.

## Уведомления

Два канала, оба дёргает `OrderNotifier` (`src/orders/order-notifier.service.ts`):
**in-app лента** покупателю при смене статуса (вставка в БД обязательна, ошибка не глотается)
и **Telegram** — продавцу (новый заказ, отмена покупателем) и покупателю дублем (мягкий канал:
нет токена или `telegramId` — тихий no-op). Дубль нужен потому, что мобилка живёт Mini App'ом
внутри Telegram: сообщение бота приходит в чат *под* приложением и невидимо, пока юзер в нём.

`GET /mobile/notifications?after&limit` → `{ items, cursor, unreadCount }`;
`POST …/read` (`ids?`, без них — все; ownership обеспечивает скоуп по `userId`, id от клиента
ничего не доказывают). Поллинг, без websocket/push.

⚠️ Курсор — `seq Int @unique @default(autoincrement())`, **не `createdAt`**: в Postgres `now()`
— время старта транзакции, строки одной транзакции делят таймстемп, и `>` терял бы записи, а
`>=` зацикливался. Без `after` отдаётся бутстрап (последние `limit`, развёрнутые по
возрастанию) — клиент рисует их прочитанными и не тостит; `cursor` возвращается всегда (на
пустой странице — эхом присланный). `payload: Json` хранит данные события, а не текст: i18n в
клиенте. `NotificationsService` не знает ни про заказы, ни про Telegram — поэтому
`OrdersModule` импортирует его без `forwardRef`.

## Telegram

**Bootstrap отдельно от хендлеров, входящие отдельно от исходящих:** `telegram-bot.service.ts`
(только запуск: токен, вебхук/поллинг, `bot.use`), `telegram-notify.service.ts` (исходящие,
свой модуль), `telegram-auth.service.ts` (вход в мобилку), `telegram-link.service.ts`
(привязка/отвязка продавца), `handlers/{seller,customer}.composer.ts`.

**Почему исходящие вынесены.** `OrdersModule` шлёт уведомления, а `seller.composer` зовёт
`OrdersService` — прямой цикл модулей. Он разорван тем, что `TelegramNotifyService` держит
собственный `Api` (это просто HTTP-клиент к Bot API), а не инстанс `Bot`. Иначе нужен
`forwardRef`.

**Порядок композеров важен:** сначала `seller`, потом `customer`. Оба ловят `/start`, и
seller-композер отдаёт управление дальше (`next()`), если `telegramId` не `SELLER`/`SUPER_ADMIN`.

**Кабинет продавца — без Mini App**, на inline-клавиатурах: активные заказы, «в доставке»,
карточка заказа с кнопками следующих статусов и URL-кнопкой «Открыть в админке» (`ADMIN_URL`).

> **`callback_data` — данные от клиента:** её можно подделать или нажать кнопку из
> пересланного сообщения. Поэтому роль и принадлежность заказа проверяются заново на **каждый**
> колбэк, а смена статуса идёт строго через `OrdersService.changeStatus` (валидация перехода,
> история, возврат остатка). Прямых `prisma.update` в композере нет.

**Привязка продавца.** В админку он входит по email/паролю, `telegramId` обычно `null`.
`POST /admin/auth/telegram/link` → `BotLinkSession(SELLER_LINK)` → ссылка/QR на
`t.me/<bot>?start=sel_<nonce>`. `linkSeller` → `ok | expired | takenByCustomer | takenByStaff`:
владельца `telegramId` он смотрит **до** апдейта, потому что P2002 знает только «занято», а
этим случаям нужны разные объяснения (P2002 — бэкстоп на гонку). `POST …/telegram/unlink`
просто обнуляет `telegramId`: уведомления молча перестают уходить, привязаться можно заново.

**Один Telegram = одна роль.** `User.telegramId` несёт ровно один смысл — «кто это»: он и
якорь входа в мобилку, и адрес кабинета в боте. Совмещать покупателя и staff'а **запрещено в
обе стороны**, правило и тексты — в `src/common/telegram-identity.ts`.
*Покупатель → staff:* занятый `telegramId` не переезжает на staff-строку, сессия привязки не
потребляется. *Staff → покупатель:* `TelegramAuthService.confirm` возвращает `'staff'` и
**сразу гасит сессию** (`consumedAt`), чтобы мобилка не поллила впустую 180 с, а
`AuthService.loginWithTelegram` (Mini App) кидает `ForbiddenException`. Иначе выходило
молчаливое слияние личностей: заказы и телефон покупателя легли бы в учётку продавца. Кому
нужны обе роли — заводит второй Telegram; автоотвязки у покупателя нет намеренно (`telegramId`
— единственный вход в его учётку, обнуление осиротило бы заказы и корзину).

## Аутентификация

**Мобилка — JWT (Bearer), access + refresh.** Защита `JwtAuthGuard` (`JWT_ACCESS_SECRET`).
Payload узкий — только `sub`/`role`/`sellerId` (`AuthPrincipal`): профильные поля
редактируемые и в токене протухали бы после `PATCH /me`, поэтому `GET /mobile/auth/me` читает
БД, а не claims. `POST /mobile/auth/refresh` — ротация (старый гасится, выдаётся новая пара);
в БД `sha256` от токена, в payload `jti`. `POST /mobile/auth/logout` отзывает refresh.

**Вход — только через Telegram** (OTP полностью удалён), бот же и регистрация: юзер заводится
по `telegramId`. Два пути в `AuthService.issueTokens`:

1. *nonce + polling* — `POST /mobile/auth/telegram/session` → `{ nonce, botUrl, expiresIn }`,
   бот ловит `/start <nonce>`, `GET …/session/:nonce` отдаёт `pending | expired | confirmed` +
   токены. Токены выдаются **ровно один раз**: `consumedAt` ставится условным `updateMany`
   (`where consumedAt: null`), поэтому гонка двух поллеров не выдаст две пары.
2. *Mini App* — `POST /mobile/auth/telegram/miniapp { initData }`. Подпись проверяется вручную
   на `node:crypto` (`secret = HMAC("WebAppData", botToken)`, сверка `hash`, свежесть
   `auth_date`) — библиотека ради 15 строк не нужна.

`PATCH /mobile/auth/me` — `{ name?, phone?, email? }`, пустая строка очищает поле, занятые
`phone`/`email` → **409** (`updateProfile` разбирает `e.meta.target` из P2002).
Бот: `TELEGRAM_USE_WEBHOOK=false` → long-polling (dev), `true` → `setWebhook` + контроллер.
Пустой `TELEGRAM_BOT_TOKEN` → приложение поднимается, бот не стартует (warning), входа нет.

**Админка — session (httpOnly cookie).** `POST /admin/auth/login` (`LocalStrategy`) →
passport-сессия, cookie `connect.sid` (`httpOnly`, `sameSite=lax`, `secure` в prod).
Хранилище — Postgres через `connect-pg-simple` (таблица `session` создаётся вне Prisma,
настройка в `src/main.ts`). Защита — `AuthenticatedGuard`; в сессии только `userId`,
пользователь подтягивается в `SessionSerializer`.

**Роли.** `RolesGuard` + `@Roles(...)` ставится **после** guard'а аутентификации;
`getAllAndOverride` берёт роли хендлера поверх ролей класса. Матрица — в таблицах «API».

## Кэш и пагинация

**`CacheService`** (`@Global`, ioredis): `wrap(ns, params, fn)` и `bump()`. Ключ —
`sf:<version>:<ns>:<sha1(stableStringify(params))>`; `stableStringify` сортирует ключи и
выбрасывает `undefined`, иначе порядок полей DTO после `ValidationPipe({transform})` давал бы
разные хэши на один запрос. Инвалидация — `INCR sf:ver`: O(1), старые ключи становятся
недостижимы и истекают сами, без SCAN/DEL.

- Кэшируется **только публичная витрина** (`listings`, `listing`, `categories`, `catalog`,
  `seller`); админские списки — никогда. Пустой `REDIS_URL` → кэш выключен.
- Fail-open: любая ошибка Redis = промах. `enableOfflineQueue: false`, `family: 0`
  (IPv6-DNS Railway), лог ошибок троттлится до 1/мин.
- Исключения из `fn` не кэшируются. Значения ходят через JSON, поэтому `Date` возвращается
  строкой — для HTTP-ответа нормально, как Prisma-сущность использовать нельзя.
- `bump()` зовут все мутации каталога/категорий/листингов/продавца и заказы — ⚠️ **после
  коммита**: изнутри транзакции кэш успел бы перезаполниться доккоммитными данными.

**Курсорная пагинация** (`src/common/pagination.ts`, `CursorPaginationDto`): `cursor?` (id
последнего элемента) + `limit` (1..100, дефолт 20) → `{ items, nextCursor }`. Контракт: сервис
обязан запрашивать `take: limit + 1` (лишняя строка — признак «есть ещё», `toCursorPage` её
срезает) и держать `orderBy`, **заканчивающийся на `id`** — только это делает курсор
детерминированным. Используют listings, catalog, categories, orders, sellers; лента
уведомлений идёт по своему `seq` и этот контракт не использует.

## Фото

`imageUploadOptions` (`src/admin/upload.options.ts`) — общие multer-опции: memoryStorage,
лимит 5 МБ, дешёвый пре-фильтр по клиентскому mimetype.

`ImageService.toWebp` (`sharp`): `metadata()` → проверка **декодированного** формата по белому
списку (jpeg/png/webp/avif/heif/gif/tiff; **SVG запрещён** — бакет публичный, SVG исполняет
скрипты) → `.rotate()` (EXIF-ориентация применяется до того, как метаданные срежутся) → resize
1600 `fit: inside` без апскейла → webp q80. EXIF/GPS не сохраняются; расширение и content-type
берутся из результата конверсии, никогда из `originalname`.

`StorageService` — S3-клиент (`forcePathStyle: true`). ⚠️ `S3_PUBLIC_URL` указывает на
**конкретный бакет**, имя бакета входит в значение (`http://localhost:9000/catalog` у MinIO,
публичный домен у R2); ссылка склеивается как `${S3_PUBLIC_URL}/${key}`, `S3_BUCKET` нужен
только для самих S3-вызовов. `keyFromUrl` — инверсия через отрезание префикса (регуляркой
нельзя: у MinIO бакет в пути, у R2 — нет).

**Галерея каталога:** `CatalogItemImage` (`url`, `sortOrder`, каскад от `CatalogItem`), максимум
10 фото, всегда `orderBy sortOrder asc`. Reorder — обмен `sortOrder` с соседом
(`direction: 'up'|'down'`) в транзакции; удаление сначала гасит объект в S3 (fire-and-forget,
ошибка логируется), потом строку. Обложка (`images[0].url`) копируется в
`OrderItem.catalogItemImageUrl`. `SELLER` грузит фото только для своих позиций. Баннер
продавца (`POST /admin/sellers/:id/image` → `Seller.bannerUrl`) — тот же пайплайн.

## Деплой (Railway)

`railway.json`: билд `pnpm build`, старт `pnpm start:railway`, healthcheck `/health`.
Инфраструктура: Railway (сервис + Postgres + Redis) + **Cloudflare R2** для фото — Railway
Buckets приватные и публичных URL не дают, а ссылка на фото лежит в БД постоянной (presigned
не подходит). Специфика `NODE_ENV=production` (`src/main.ts`):

- `app.set('trust proxy', 1)` — иначе за TLS-терминатором `express-session` не поставит cookie
  с `secure: true`;
- cookie сессии `sameSite: 'none'` — админка на другом домене;
- `app.listen(port, '0.0.0.0')` — на `localhost` прокси не достучится (502);
- `CORS_ORIGIN` — точный список доменов, не `*` (с `credentials: true` браузер отклоняет `*`);
- бот — **только webhook**: при редеплое и нескольких репликах два поллера конфликтуют.
  `numReplicas: 1` не случайно — масштабирование даёт те же конфликты и гонки на инвентаре.

## Конвенции

- DTO — классы с `class-validator` + `@ApiProperty`; глобальный `ValidationPipe`
  (`whitelist`, `transform`, `forbidNonWhitelisted`) отклоняет лишние поля.
- Типы из `@prisma/client` в **декорированных сигнатурах** (`@CurrentUser() u: AuthUser`) —
  через `import type` (`isolatedModules` + `emitDecoratorMetadata`).
- После правки `schema.prisma` — `pnpm db:migrate`; на проде `pnpm db:deploy`.
- `prisma/` исключена из `nest build` (`tsconfig.build.json`), иначе сдвигается `dist/`.
- `CLAUDE.md` — просто `@AGENTS.md`, копии нет: правится только этот файл.

## Проверка изменений

⚠️ **Автотестов фактически нет:** ни одного `*.spec.ts` в `src/`. `test/app.e2e-spec.ts` —
нетронутый скаффолд Nest, ждёт `GET /` → `Hello World!`, такого роута нет, так что
`pnpm test:e2e` падает by construction. Всё проверяется руками (curl / Swagger). Инварианты,
которые стоит прогонять:

- витрина без токена: `listings`/`categories`/`sellers` — 200, `catalog`/`cart`/`orders`/
  `notifications` — 401;
- старый refresh после ротации → 401; сессии админки появляются в таблице `session`;
- `SELLER`, создавая категорию/позицию каталога, получает `PENDING`, `SUPER_ADMIN` — `APPROVED`;
- второй `SELLER` не видит чужую кастомную категорию/позицию и не может сослаться на неё
  в листинге (403);
- заказ на количество больше `stock` не проходит; отмена возвращает остаток;
- после мутации каталога витрина сразу отдаёт свежие данные (значит `bump()` не забыт).
