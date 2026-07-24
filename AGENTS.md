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
pnpm db:seed                  # засидить супер-админа (больше сид ничего не создаёт)
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

Сид создаёт **только супер-админа** — `admin@stealth.local` / `+998900000001`
(справочник, категории, продавцы). Пароль — из `SEED_ADMIN_PASSWORD`, локальный
дефолт `password123`. Продавцы, категории, каталог и листинги заводятся через
админку: сид намеренно не наполняет БД демо-данными, чтобы его можно было
безопасно прогонять на проде.

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
  telegram/        # Бот (grammy): bootstrap + композеры-хендлеры + исходящие (см. «Telegram»)
  users/           # UsersService (поиск/создание/профиль/пароль)
  cart/            # CartService — корзина покупателя
  addresses/       # AddressesService — адресная книга покупателя (сохранённые адреса)
  orders/          # OrdersService — заказы, карта переходов статусов, уведомления
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
  поля**, юзер дозаполняет их сам через `PATCH /mobile/auth/me`. Обязательными они становятся
  только в checkout: имя и телефон уходят в снапшот заказа, а телефон, если его не было,
  дописывается сюда (номер, занятый другим аккаунтом, — P2002 — молча пропускается).
  `passwordHash?` (nullable — есть только у админов),
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
- **BotLinkSession** — та же механика «сходить в бота и вернуться», но для **уже известного**
  пользователя: `userId` берётся из текущей авторизации, а не создаётся ботом. Одна таблица на
  два назначения (`purpose`): `DELIVERY_LOCATION` (покупатель шлёт геопозицию для адреса) и
  `SELLER_LINK` (продавец привязывает Telegram к аккаунту админки). `TelegramAuthSession`
  намеренно оставлена отдельной — она выдаёт токены и консьюмится иначе.
- **CartItem** — позиция корзины прямо на `User`, без обёртки `Cart`: у пользователя неявно
  одна корзина, отдельная сущность не нужна (та же логика, что у `RefreshToken`).
- **SavedAddress** — адресная книга покупателя (`label?`, `address`, `comment?`, `lat?`/`lng?`),
  `onDelete: Cascade` от `User`. **Не источник правды для отображения заказа** — `Order` держит
  свой снапшот (`deliveryAddress/deliveryComment/deliveryLat/deliveryLng`) и лишь опциональный
  `savedAddressId` (`onDelete: SetNull`) для трейсинга «каким сохранённым адресом пользовались».
  Редактирование или удаление `SavedAddress` задним числом не меняет уже оформленные заказы —
  тот же принцип, что у `OrderItem` (снапшот `Listing`) и `Order.contactName/contactPhone`
  (снапшот `User.name/phone`).
- **Order / OrderItem / OrderStatusHistory** — см. раздел «Заказы».

## Заказы

**Один checkout = N заказов.** Корзина может содержать листинги разных продавцов, поэтому
`OrdersService.createFromCart` режет её по `sellerId`: каждому продавцу свой `Order` со своим
статусом и своей доставкой. Заказы одного оформления связывает поле `groupId` (обычный
`randomUUID`, генерируется в сервисе). **Отдельной модели `Checkout` нет** — по той же
причине, по которой нет обёртки `Cart` над `CartItem`: сущность без собственных полей не нужна.

**`OrderItem` — полный снапшот, а не FK.** Имя, картинка, единица и цена копируются на момент
оформления: листинг дорожает, уезжает в `ARCHIVED` или удаляется (`listingId` станет `null`),
а заказ обязан остаться читаемым. Деньги (`itemsTotal`/`deliveryFee`/`total`) — тоже снапшот,
как и контакты (`contactName`/`contactPhone`).

**Защита от гонки за остатком.** Списание идёт условным апдейтом внутри транзакции:
`updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })`,
и `count === 0` роняет всю транзакцию. Проверка остатка *до* транзакции нужна лишь ради
понятного текста ошибки с названием товара. Тот же приём, что claim сессии в
`TelegramAuthService.poll`. Отмена заказа возвращает остаток (`increment`) в той же транзакции.

**Статусы — `src/orders/order-status.ts`.** `ALLOWED_TRANSITIONS` — **единственный источник
правды**: из неё валидируется `PATCH /admin/orders/:id/status`, строятся inline-кнопки в
кабинете продавца в боте и селект в админке. Дублировать список где-либо ещё нельзя.

```
NEW → CONFIRMED → ASSEMBLING → DELIVERING → ARRIVED → DELIVERED
        (из любого нетерминального) → CANCELLED
```

`ARRIVED` («курьер на месте») существует ради уведомления покупателю «выходите, курьер приехал» —
продавец жмёт эту кнопку в боте или меняет статус в админке.

**Оплата.** Пока только `CASH` (наличные курьеру), выбора в UI нет и `paymentMethod` в
`CreateOrderDto` отсутствует — сервис ставит дефолт. Payme/Click подключаются добавлением
значений в енам (миграция на одну строку); колонок `providerTxnId`/`providerPayload` в `Order`
нет намеренно — у провайдера на заказ бывает несколько попыток, это будущая модель `Payment`.

**Доставка.** Курьер получает три слоя: обязательный текстовый адрес + комментарий,
необязательные `deliveryLat/Lng` из Telegram-локации и — главное — нативную карточку локации
в Telegram, у которой есть встроенная кнопка «Маршрут» в Яндекс/Google Картах. Карт-SDK и
платных API не нужно. Отдельной сущности курьера пока нет: продавец пересылает карточку
локации своему курьеру (пересылка сохраняет геоточку). Поля `courierName`/`courierPhone` —
задел: когда появится модель `Courier`, тот же `sendMessage` + `sendLocation` пойдёт ему напрямую.

**Адресная книга (`SavedAddress`) и снапшот в `CreateOrderDto`.** Покупатель может оформить
заказ либо сырыми полями (`deliveryAddress`/`deliveryComment`/`deliveryLat`/`deliveryLng`), либо
сославшись на сохранённый адрес (`savedAddressId`) — тогда сырые поля игнорируются, а
`deliveryAddress` условно необязателен (`@ValidateIf((o) => !o.savedAddressId)`). Опциональный
флаг `saveAddress: boolean` (только в паре с сырыми полями, не с `savedAddressId`) создаёт новую
`SavedAddress` **внутри той же `$transaction`**, что и заказ — конфликтов уникальности тут нет
(в отличие от бэкфилла телефона ниже), поэтому отдельного пост-коммитного шага не нужно.
`OrdersService.createFromCart` резолвит адрес **один раз на весь checkout** (до цикла по
продавцам) и копирует один и тот же снапшот во все N заказов группы — `savedAddressId`
принадлежность проверяет `AddressesService.findOwned` (публичный метод, переиспользуется отсюда
же).

Эндпоинты:

- `POST /mobile/orders` — оформить корзину → массив заказов. **Class-level `JwtAuthGuard`**,
  как у `mobile-cart.controller.ts` (гостевых заказов нет).
- `GET /mobile/orders`, `GET /mobile/orders/:id`, `POST /mobile/orders/:id/cancel`
  (покупатель отменяет только из `NEW`/`CONFIRMED`)
- `POST /mobile/orders/delivery/location/session` + `GET …/:nonce` — nonce и поллинг адреса.
  **Объявлены в контроллере раньше `:id`-роутов**, иначе `GET /mobile/orders/:id` их перехватит.
- `GET/POST /mobile/addresses`, `PATCH/DELETE /mobile/addresses/:id` — CRUD адресной книги
  (`MobileAddressesController`, class-level `JwtAuthGuard`, всё scoped по `userId` в
  `AddressesService`, тот же паттерн, что `MobileCartController`/`CartService`).
- `GET /admin/orders` (фильтр `status`, поиск по номеру/телефону/имени), `GET /admin/orders/:id`,
  `PATCH /admin/orders/:id/status`, `PATCH /admin/orders/:id/courier` —
  `AuthenticatedGuard + RolesGuard`, `@Roles(SELLER, SUPER_ADMIN)`. `SELLER` жёстко скоупится
  своим `sellerId`, и его query-параметр `sellerId` игнорируется — та же схема видимости,
  что в `CategoriesService`.

## Telegram

Модуль разнесён: **bootstrap отдельно от хендлеров, входящие отдельно от исходящих.**

```
telegram/
  telegram-bot.service.ts        # только запуск: токен, вебхук/поллинг, bot.use(композеры)
  telegram-notify.service.ts     # ИСХОДЯЩИЕ: sendMessage / sendLocation
  telegram-notify.module.ts      # отдельный модуль без зависимостей
  telegram-auth.service.ts       # вход в мобилку (nonce + Mini App initData)
  telegram-link.service.ts       # BotLinkSession: адрес доставки + привязка продавца
  handlers/customer.composer.ts  # /start <nonce>, /start loc_<nonce>, message:location
  handlers/seller.composer.ts    # кабинет продавца
```

**Почему исходящие вынесены.** `OrdersModule` шлёт уведомления, а `seller.composer` зовёт
`OrdersService` — прямой цикл модулей. Он разорван тем, что `TelegramNotifyService` держит
собственный `Api` (это просто HTTP-клиент к Bot API), а не инстанс `Bot`. Без этого
потребовался бы `forwardRef`.

**Порядок композеров важен:** сначала `seller`, потом `customer`. Оба ловят `/start`, и
seller-композер отдаёт управление дальше (`next()`), если у `telegramId` не роль
`SELLER`/`SUPER_ADMIN`. **Покупательская ветка от этого не изменилась**: Mini App с
авто-логином, `/start <nonce>` для входа, `/start loc_<nonce>` для адреса — всё как было.

**Кабинет продавца — без Mini App**, на обычных inline-клавиатурах: список активных заказов,
список «в доставке», карточка заказа с кнопками следующих статусов и URL-кнопкой «Открыть в
админке» (`ADMIN_URL` — новая переменная окружения).

> **`callback_data` — данные от клиента.** Её можно подделать или нажать кнопку из
> пересланного кому-то сообщения. Поэтому роль и принадлежность заказа проверяются заново
> на **каждый** колбэк (`resolveSeller` + `OrdersService`), а смена статуса идёт строго через
> `OrdersService.changeStatus` — там валидация перехода, история и возврат остатка.
> Прямых `prisma.update` в композере нет.

**Привязка продавца.** В админку продавец входит по email/паролю, `telegramId` у него обычно
`null`. Кнопка в сайдбаре → `POST /admin/auth/telegram/link` → `BotLinkSession(SELLER_LINK)` →
ссылка/QR на `t.me/<bot>?start=sel_<nonce>`.

### Один Telegram = одна роль (жёсткий блок в обе стороны)

`User.telegramId` несёт ровно один смысл — «кто это»; он служит и якорем входа в мобилку, и
адресом кабинета в боте. Поэтому совмещать в одном Telegram покупателя и staff'а **запрещено
в обе стороны**. Правило и тексты — в `src/common/telegram-identity.ts`, оба конца ссылаются
туда, чтобы формулировки не разъехались.

- **Покупатель → staff.** `TelegramLinkService.linkSeller` до апдейта смотрит, кем занят
  `telegramId`, и возвращает `takenByCustomer` либо `takenByStaff` — P2002 знает только
  «занято», а этим двум случаям нужны разные объяснения. Занятый `telegramId` **не
  переезжает** на staff-строку, сессия привязки не потребляется (можно повторить с другого
  аккаунта). P2002 остаётся бэкстопом на гонку.
- **Staff → покупатель.** Блокируются **оба** входа в мобилку: `TelegramAuthService.confirm`
  (бот, `/start <nonce>`) возвращает `'staff'` и **сразу гасит сессию** через `consumedAt`,
  чтобы мобилка не поллила впустую все 180 с; `AuthService.loginWithTelegram` (Mini App)
  кидает `ForbiddenException`.

Без этого запрета было две беды. В одну сторону — unique-конфликт с тупиком: logout мобилки
`telegramId` не освобождает, и привязка становилась невозможна навсегда. В другую, что
гораздо хуже, — **молчаливое слияние личностей**: `findByTelegramId` находил staff-строку и
выдавал на неё токены, заказы и телефон покупателя ложились в учётку продавца, а отдельной
покупательской личности не возникало вовсе.

Кому нужны обе роли — заводит второй Telegram-аккаунт под магазин. Автоматической «отвязки»
намеренно нет: `telegramId` покупателя — единственный способ войти в его учётку, и обнуление
осиротило бы заказы и корзину.

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
  Локально — **MinIO** (`docker-compose.yml`, бакет `catalog`, публичное чтение),
  на проде — **Cloudflare R2**. Меняются только env (`S3_*`), код не трогаем.
- ⚠️ `S3_PUBLIC_URL` указывает на **конкретный бакет**, имя бакета входит в
  значение (`http://localhost:9000/catalog` для MinIO, публичный домен для R2).
  `upload()` склеивает ссылку как `${S3_PUBLIC_URL}/${key}` и `S3_BUCKET` в путь
  не подставляет — он нужен только для самих S3-вызовов.
- `POST /admin/catalog/:id/image` (multipart, поле `file`, `FileInterceptor` с
  `memoryStorage`, лимит 5MB, только `image/*`) — загружает в S3 и обновляет
  `CatalogItem.imageUrl`. Владелец-проверка: `SELLER` может грузить фото только
  для своих позиций.

## Деплой (Railway)

`railway.json`: билд — `pnpm build` (внутри `prisma generate && nest build`),
старт — `pnpm start:railway` (`prisma migrate deploy && node dist/main`),
healthcheck на `/health`.

Инфраструктура: **Railway** (сервис + Postgres-аддон) + **Cloudflare R2** (фото).
R2, а не Railway Buckets: последние приватные, публичных URL не дают
(«Public buckets are currently not supported»), а `CatalogItem.imageUrl` хранится
в БД постоянной ссылкой — presigned не подходит.

Что специфично для прода (`NODE_ENV=production`) в `src/main.ts`:
- `app.set('trust proxy', 1)` — иначе за TLS-терминатором Railway
  `express-session` не поставит cookie с `secure: true`;
- cookie сессии `sameSite: 'none'` — админка на другом домене, cookie cross-site;
- `app.listen(port, '0.0.0.0')` — на `localhost` прокси не достучится (502);
- `CORS_ORIGIN` — точный список доменов, не `*` (с `credentials: true` браузер
  отклоняет `*`).

Telegram-бот на проде — **только webhook** (`TELEGRAM_USE_WEBHOOK=true` +
`TELEGRAM_WEBHOOK_URL`): при редеплое/нескольких репликах два поллера конфликтуют.

`numReplicas: 1` в `railway.json` не случайно — при масштабировании появятся
конфликт поллеров бота (если вернуть polling) и гонки на инвентаре в заказах.

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
