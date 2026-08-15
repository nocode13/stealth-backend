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
                           # telegram-identity.ts (покупатель и staff — разные учётки)
  auth/                    # стратегии и guard'ы: JWT / session / local
  users/ sellers/ categories/ catalog/ listings/ cart/ addresses/ settings/
  orders/                  # OrdersService, order-status.ts, order-notifier.service.ts
  notifications/ metrics/  # in-app лента · агрегаты для дашборда админки
  storage/                 # StorageService (S3) + ImageService (sharp → webp)
  telegram/                # два бота: bootstrap + композеры + исходящие + вход по номеру
  admin/ mobile/           # API-поверхности (+ admin/upload.options.ts)
```

## Доменная модель (`prisma/schema.prisma`)

**Сущность без собственных полей не заводится**: нет обёртки `Cart` над `CartItem` (корзина у
юзера неявно одна). Отдельная модель `Checkout` тоже не заводится — её роль играет
**`OrderGroup`**: заказы одного оформления связывает `Order.groupId`, настоящий FK
на `order_groups.id` (не просто строка).

- **User** — `telegramId?` (nullable unique) — **якорь личности покупателя** (основной бот);
  `staffTelegramId?` (nullable unique) — адрес кабинета в боте продавца, колонки независимы
  (см. «Telegram»). `phone?`/`email?` (nullable unique) и `name?` — опциональные, юзер
  дозаполняет через `PATCH /mobile/auth/me`; обязательны только в checkout (уходят в снапшот
  заказа, телефон дописывается в профиль, P2002 молча пропускается). При входе по номеру
  `phone` заполняется сразу — он уже подтверждён. `passwordHash?` только у админов (у
  сотрудника его может не быть — тогда в админку он не входит, но кабинет в боте работает),
  `role`, `sellerId?`.
- **Seller** — арендатор: `name`, `description?`, `bannerUrl?`, `status`, `ownerUserId`.
  **Команда — это `members` (`User.sellerId`), их много на одного продавца**: все они
  `role: SELLER` с одним `sellerId`, то есть уже существующий скоуп заказов/листингов/каталога
  работает на них без изменений, а уведомления о заказе уходят **всем**. Владелец
  (`ownerUserId`, unique) — такой же участник, отличается только тем, что не удаляется:
  на нём висит сам продавец (`onDelete: Cascade`). Отдельной модели `SellerMember` нет —
  своих полей у неё не было бы.
- **Category** / **CatalogItem** — общий паттерн владения и ревью:
  `sellerId = null` → **master**, создаёт только `SUPER_ADMIN`, сразу `APPROVED`;
  `sellerId` заполнен → продавец предложил свою, `PENDING` до апрува (`PATCH …/:id/status`).
  После апрува доступна для выбора/листинга **только этому продавцу** (наряду с master), но
  на витрине мобилки видны **все** `APPROVED` — ограничение касается создания, не показа.
  `Category`: `nameRu` (обязательное, фолбэк) + `nameUz?/nameEn?/nameKaa?`.
  `CatalogItem`: `categoryId?` (nullable, `Restrict`), `unit` (дефолт «шт»), галерея
  `images: CatalogItemImage[]`. Общий enum `ReviewStatus`. `freeDelivery: Boolean` —
  вайтлист бесплатной доставки, ставит только `SUPER_ADMIN` (см. «Доставка» ниже).
- **Listing** — предложение продавца поверх позиции: `price`, `stock`, `status`
  (`DRAFT|ACTIVE|ARCHIVED`), `@@unique([sellerId, catalogItemId])`. При создании
  `CatalogService.assertUsable` проверяет, что позиция одобрена и видна этому продавцу.
- **PlatformSettings** — синглтон-строка (`id = "default"`), правит `SUPER_ADMIN` из
  `admin/settings`: `deliveryFee` (тариф за чекаут) и `freeDeliveryThreshold?` (порог
  бесплатной доставки, `null` = порога нет). `SettingsService.quote()` — единственное
  место в проекте, где считается доставка (см. «Доставка» ниже).
- **Деньги — `Int` в тийинах** (1 сум = 100 тийин), колонки валюты нет.
- **RefreshToken** — sha256-хэши активных refresh-токенов.
- **TelegramAuthSession** — вход по nonce; токенов в ней нет (при консьюме выпускается свежая
  пара), поэтому в таблице нет секретов. **BotLinkSession** — «сходить в бота и вернуться»
  для уже известного юзера, `purpose` сейчас только `SELLER_LINK`, TTL 300 с.
- **PhoneAuthSession** — вход по номеру (TTL 600 с: юзеру надо сходить в бота и вернуться).
  Хранит заявленный `phone`, `telegramId`/`name` из бота, `codeHash` (sha256 OTP, `null` —
  номер ещё не подтверждён), счётчик `attempts` и флаг `mismatch`. Отдельная модель, а не
  поля в `TelegramAuthSession`: другой жизненный цикл (два шага подтверждения).
- **SavedAddress** — адресная книга (`label?`, `address`, `comment?`, `lat?/lng?`).
- **Notification** — in-app лента. **OrderGroup / Order / OrderItem / OrderStatusHistory** —
  см. «Заказы»; `orderNumber`/`groupNumber` autoincrement, по ним ищут в админке.

**Снапшоты, а не FK.** `OrderItem` копирует имя, обложку, единицу и цену; `OrderGroup` —
контакты, адрес и способ оплаты **одним разом на весь чекаут** (раньше это дублировалось в
каждом `Order`). Листинг может подорожать, уехать в `ARCHIVED` или удалиться (`listingId` →
`null`), `SavedAddress` — измениться, но оформленный заказ обязан остаться читаемым.
`savedAddressId` (`SetNull`, теперь на `OrderGroup`) хранится только ради трейсинга.

**Доставка платформенная, не продавцовая.** `OrderGroup.itemsTotal/deliveryFee/total` — итог
по всему чекауту, тариф считается один раз через `SettingsService.quote()` и **снапшотится**
в группу на момент оформления (смена тарифа не трогает уже созданные заказы). `Order` несёт
только `itemsTotal` — долю конкретного продавца, на ней держатся метрики выручки и карточка
в боте; доставка на заказ не раскладывается и колонок `deliveryFee`/`total` у него нет.

**Статус группы выводится, не выставляется.** `OrderGroupStatus` повторяет `OrderStatus` плюс
`PARTIALLY_DELIVERED` (часть продавцов уже довезла, часть нет — возможно только у группы).
`deriveGroupStatus()` (`src/orders/order-status.ts`) считает его из статусов заказов группы
после каждого `changeStatus`/`cancelMine`; второй карты переходов нет — источник правды
остаётся один, `ALLOWED_TRANSITIONS` у `Order`. Никакая поверхность не пишет
`OrderGroup.status` напрямую. Таймлайн группы — `OrderGroupStatusHistory` (зеркало
`OrderStatusHistory`), пишется там же, в `applyStatusTx`, но только когда выведенный статус
**реально изменился**: иначе каскад по нескольким заказам группы за одну операцию
(`changeGroupStatus`, `cancelMyGroup`) плодил бы запись на каждый задетый заказ вместо одной
на фактический переход.

## API

Глобального префикса нет. **Админка** — везде `AuthenticatedGuard + RolesGuard`, кроме `auth`:

| Роут | Роли | Эндпоинты |
|---|---|---|
| `admin/auth` | — | `POST login` (LocalAuthGuard), `POST logout`, `GET me`, `POST telegram/link`, `POST telegram/unlink` |
| `admin/categories` | SUPER_ADMIN, SELLER | CRUD + `PATCH /:id/status` — **только SUPER_ADMIN** (`@Roles` на хендлере перебивает класс) |
| `admin/catalog` | SUPER_ADMIN, SELLER | CRUD + `POST /:id/images`, `DELETE /:id/images/:imageId`, `PATCH /:id/images/:imageId/reorder` |
| `admin/listings` | SELLER, SUPER_ADMIN | CRUD, `sellerId` из пользователя |
| `admin/orders` | SELLER, SUPER_ADMIN | `GET /` — группы (фильтр `status`, поиск по номеру группы/заказа/телефону/имени), `GET /:id` (`:id` — id группы), `PATCH /:orderId/status`, `PATCH /:orderId/courier` (`:orderId` — id заказа внутри группы) — **только `SUPER_ADMIN`** |
| `admin/sellers` | SUPER_ADMIN | CRUD + `POST /:id/image` (баннер) |
| `admin/sellers/:sellerId/staff` | SUPER_ADMIN, **владелец** | `GET /`, `POST /`, `PATCH /:staffId`, `DELETE /:staffId`, `POST /:staffId/telegram/invite`, `POST /:staffId/telegram/unlink` |
| `admin/metrics` | SUPER_ADMIN | `GET users`, `GET orders`, `GET catalog`, `GET overview` |
| `admin/settings` | SUPER_ADMIN | `GET /`, `PATCH /` — тариф доставки/порог бесплатной доставки |

`SELLER` жёстко скоупится своим `sellerId`; его query-параметр `sellerId` игнорируется.

**Команда — отдельный контроллер** (`admin-seller-staff.controller.ts`), а не хендлеры в
`AdminSellersController`: у того на классе `@Roles(SUPER_ADMIN)`, а сюда пускают ещё и
владельца. Роли тут мало — `SellerStaffService.assertCanManage` дополнительно требует
`seller.ownerUserId === user.id`, иначе рядовой сотрудник заводил бы себе коллег. Владельца
удалить нельзя (400), P2003 при удалении → 409.

**Мобилка.** Optional-auth в проекте нет — доступ бинарный, на уровне контроллера.

| Роут | Guard | Эндпоинты |
|---|---|---|
| `mobile/auth` | JwtAuthGuard только на `me`/`logout` | `POST telegram/session`, `GET telegram/session/:nonce`, `POST telegram/miniapp`, `POST phone/session`, `GET phone/session/:nonce`, `POST phone/verify`, `POST refresh`, `GET/PATCH me`, `POST logout` |
| `mobile/listings`, `mobile/categories`, `mobile/sellers/:id` | **публичные** | витрина; сервис жёстко фильтрует (`ACTIVE`+`stock>0`, `APPROVED`, `ACTIVE`) и игнорирует `status` из query |
| `mobile/catalog` | JwtAuthGuard | `GET /` — ⚠️ асимметрия: остальная витрина публичная |
| `mobile/cart` | JwtAuthGuard | `GET /`, `POST items`, `PATCH/DELETE items/:id`, `DELETE /` |
| `mobile/addresses` | JwtAuthGuard | CRUD, всё scoped по `userId` |
| `mobile/order-groups` | JwtAuthGuard | `POST /`, `GET /`, `GET /:id`, `POST /:id/cancel` |
| `mobile/notifications` | JwtAuthGuard | `GET /`, `POST read` |
| `mobile/settings` | **публичный** | `GET /` — `{ deliveryFee, freeDeliveryThreshold }`, как остальная витрина |

Плюс `GET /health` и вебхуки `POST /telegram/webhook` (основной бот) и
`POST /telegram/webhook/seller` (бот продавца) — без гварда, каждый сверяет свой секрет в
заголовке `x-telegram-bot-api-secret-token`, скрыты из Swagger `@ApiExcludeController`.

**Метрики** — счётчики юзеров/заказов/каталога и `overview`; `from`/`to` включительно, оба
необязательны (нет = за всё время), кэша нет. ⚠️ «Сегодня» считается по UTC, не по Ташкенту;
`revenue` исключает `CANCELLED`, а `byStatus` — нет, поэтому суммы не сходятся by design.

## Заказы

**Один checkout = одна `OrderGroup` + N заказов.** Корзина может содержать листинги разных
продавцов, поэтому `createFromCart` сперва создаёт `OrderGroup` (контакты, адрес, оплата,
общий итог), затем режет корзину по `sellerId`: каждому свой `Order` со своим статусом,
`groupId` — FK на эту группу. Эндпоинт `POST /mobile/order-groups` отдаёт группу целиком
(`OrderGroupResponse`, вложенные `orders`), а не массив заказов.

**Гонка за остатком.** Списание — условным апдейтом внутри транзакции:
`updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })`,
`count === 0` роняет транзакцию. Проверка *до* транзакции нужна лишь ради понятной ошибки с
названием товара. Отмена возвращает остаток (`increment`) там же. Тот же приём — claim сессии
в `TelegramAuthService.poll`.

**Статусы — `src/orders/order-status.ts`.** `ALLOWED_TRANSITIONS` — **единственный источник
правды**: из неё валидируется `PATCH /admin/orders/:orderId/status` (только `SUPER_ADMIN`) и
селект в админке. Дублировать нельзя. Там же подписи статусов/кнопок и тексты покупателю.

**Админка листает группы, не заказы.** `GET /admin/orders` и `GET /admin/orders/:id` отдают
`OrderGroupResponse` (группа — корень, `orders: OrderResponse[]` — без обратной ссылки на
группу, циклов нет). `SELLER` получает группы, где участвует, но внутри — только свои `orders`
(изоляция — в `where` на уровне `orders` при запросе, не постфактум фильтрацией ответа), и
суммы группы (`itemsTotal`/`deliveryFee`/`total`) пересчитаны по видимому
(`toSellerOrderGroupResponse`) — иначе он видел бы оборот соседа по группе. Статус и курьера
меняет только `SUPER_ADMIN`: `PATCH /admin/orders/:orderId/status|courier` берёт id
конкретного `Order` внутри группы, но отдаёт группу целиком — деталка в админке заменяет своё
состояние одним объектом. Мобилка листает те же группы через `mobile-order-groups.controller.ts`
(`POST/GET /mobile/order-groups`, `GET /:id`, `POST /:id/cancel`) — покупателю заказ **это**
группа, плоских `Order` в ответе нет нигде. Старых `/mobile/orders` (заказ с вложенной группой)
больше не существует: установки из Play, оставшиеся на прежней версии приложения, перестают
работать до обновления — решение принято осознанно, экрана «обновите приложение» нет.

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
резолвится **один раз на весь checkout** и кладётся в `OrderGroup` (не копируется в каждый
`Order`). Курьеру уходит текст + нативная карточка локации Telegram — у неё встроенная кнопка
«Маршрут» в Яндекс/Google Картах. Модели курьера нет: `courierName`/`courierPhone` (на
`Order`) — задел, продавец пересылает карточку сам (пересылка сохраняет геоточку).

**Деньги.** Доставка платформенная и считается **один раз на весь чекаут** —
`SettingsService.quote(itemsTotal, { allFreeDelivery })` (`src/settings/settings.service.ts`,
единственное место с формулой доставки), результат снапшотится в `OrderGroup.deliveryFee/total`
при оформлении. `Order.itemsTotal` — доля конкретного продавца, без доставки. Бесплатно, если
сумма товаров достигла `PlatformSettings.freeDeliveryThreshold` **или** вся корзина состоит из
позиций с `CatalogItem.freeDelivery` (смешанная корзина — платная, иначе один дешёвый
«бесплатный» товар открывал бы бесплатную доставку на всё). Оплата только `CASH`, поэтому
`paymentMethod` в `CreateOrderDto` отсутствует, бэкенд ставит его сам на `OrderGroup`.
Payme/Click — добавлением значений в енам; `providerTxnId`/`providerPayload` нет намеренно: у
провайдера на заказ бывает несколько попыток, это будущая модель `Payment`.

**После коммита**, в этом порядке: `cache.bump()` → бэкфилл телефона/имени → уведомление продавцу.

## Уведомления

Три канала, все дёргает `OrderNotifier` (`src/orders/order-notifier.service.ts`):
**in-app лента** покупателю при смене статуса (вставка в БД обязательна, ошибка не глотается),
**push** покупателю на нативные установки и **Telegram** — продавцу в бот продавца (новый
заказ, отмена покупателем, по `staffTelegramId`) и покупателю в основной бот (по `telegramId`;
мягкий канал: нет токена или id — тихий no-op).

⚠️ **Покупателя уведомляет ГРУППА, а не `Order`** — все три канала. Единица уведомления та же,
что единица заказа в мобилке: плоских `/mobile/orders` нет, и каскад `changeGroupStatus` по трём
продавцам обязан дать **одно** сообщение «заказ едет», а не три с разными `orderNumber`.
`OrderNotifier.groupStatusChanged(group, { feedOnly? })` шлёт лента+push+Telegram, тексты —
`CUSTOMER_GROUP_STATUS_MESSAGES` (`src/orders/order-status.ts`, ключуется `OrderGroupStatus`,
поэтому есть и `PARTIALLY_DELIVERED`; `NEW` не шлётся — покупатель сам только что оформил).
Заголовок и DM — `Заказ №<groupNumber>` (`№` = группа, `#` = `Order`, как в карточках бота).

⚠️ Условие отправки — **реальная смена выведенного статуса группы**, тот же инвариант, что у
`OrderGroupStatusHistory`. Проверку делает `OrdersService`, а не нотифаер: сравнивается
`OrderGroup.status` **до** операции и **после коммита** (`changeStatus`, `changeGroupStatus`,
`cancelMyGroup`). Флаг из `applyStatusTx` наружу не тащится — сравнение «до/после» схлопывает
каскад по N заказам в одну дельту само. Смена одного `Order`, не сдвинувшая
`deriveGroupStatus` (сосед позади), уведомления не даёт вовсе.

⚠️ **Самоотмена — `feedOnly`.** `cancelMyGroup` пишет строку в ленту (история должна быть
полной), но push и DM покупателю не шлёт: это уведомление человека о его же нажатии секунду
назад. Продавцам `cancelledByCustomer` уходит по-прежнему — и только по заказам, отменённым
**этой** операцией, а не по всем в группе.

Payload ленты и `data` пуша: `{ groupId, groupNumber, status }` под типом
`NotificationType.ORDER_GROUP_STATUS_CHANGED`. Старое значение `ORDER_STATUS_CHANGED`
(`{ orderId, orderNumber, status }`) осталось в енаме ради уже накопленных строк, но больше не
эмитится, поэтому **бутстрап-страница ленты бывает смешанной** — клиент обязан игнорировать
незнакомый `type`, а не падать на нём. `orderId` там указывал на сущность, которую мобилка
запросить не может: эндпоинта по одному `Order` в мобильном API нет.

⚠️ **Push и Telegram-DM покупателю взаимоисключающие.** `groupStatusChanged` сначала пробует
`PushService.sendToUser`, и только если тот вернул `false` (нет живых токенов либо Expo
недоступен) — шлёт сообщение в бот. Иначе юзер с приложением и ботом получал бы два
уведомления об одном событии. Telegram-канал никуда не девается: в Mini App и вебе пушей нет
вовсе, а сообщение бота там приходит в чат *под* приложением и невидимо, пока юзер в нём.

**`src/push/`** — отдельный домен по образцу `TelegramNotifyModule`: только исходящие, без
импортов, чтобы `OrdersModule` не получил цикл. `PushTokensService` — реестр (`register` —
upsert **по самому токену**, а не по паре с `userId`: токен принадлежит установке, и после
входа другого юзера на том же устройстве строка обязана переехать к нему, иначе пуши уйдут
прошлому владельцу). `PushService` — отправка через `expo-server-sdk` с двумя проходами
чистки битых токенов: тикеты сразу + receipts через 15 секунд (`DeviceNotRegistered` = снесли
приложение). Тексты берутся из `CUSTOMER_GROUP_STATUS_MESSAGES` — того же источника, что Telegram-DM;
это осознанное отступление от правила «текст живёт на клиенте», потому что тело пуша рендерит
ОС, а клиента в этот момент нет. `EXPO_ACCESS_TOKEN` опционален (пусто = как пустой
`TELEGRAM_BOT_TOKEN`).

⚠️ **Продавцу — веером по всей команде**, а не одному владельцу: `sellerTelegramIds(sellerId)`
собирает всех `User` с этим `sellerId` (плюс владельца отдельной веткой `ownedSeller` — на
случай пустого `sellerId` у него) и непривязанных отсеивает по `staffTelegramId != null`.
Рассылка идёт через `fanOut`, у которого **try/catch на каждого адресата**: заблокировавший
бота сотрудник не должен лишать уведомления остальных. Пустой список — warning в лог, заказ
живёт в админке.

`GET /mobile/notifications?after&limit` → `{ items, cursor, unreadCount }`;
`POST …/read` (`ids?`, без них — все; ownership обеспечивает скоуп по `userId`, id от клиента
ничего не доказывают). Лента — поллинг, без websocket.
`POST …/push-token` (`{ token, platform }`) и `DELETE …/push-token` (`{ token }`, зовётся при
логауте: удаляем только этот токен, выход на одном устройстве не гасит пуши на остальных).

⚠️ Курсор — `seq Int @unique @default(autoincrement())`, **не `createdAt`**: в Postgres `now()`
— время старта транзакции, строки одной транзакции делят таймстемп, и `>` терял бы записи, а
`>=` зацикливался. Без `after` отдаётся бутстрап (последние `limit`, развёрнутые по
возрастанию) — клиент рисует их прочитанными и не тостит; `cursor` возвращается всегда (на
пустой странице — эхом присланный). `payload: Json` хранит данные события, а не текст: i18n в
клиенте. `NotificationsService` не знает ни про заказы, ни про Telegram — поэтому
`OrdersModule` импортирует его без `forwardRef`.

## Telegram

**Ботов два.** **Основной** (`TELEGRAM_BOT_TOKEN`) — покупатели: вход в мобилку и уведомления
им же. **Продавца** (`TELEGRAM_SELLER_BOT_TOKEN`) — кабинет заказов и уведомления продавцу.
Разделены потому, что один человек может быть и покупателем, и продавцом; каждый бот ищет
своего юзера по своей колонке (`telegramId` против `staffTelegramId`). Пустой токен любого из
них → приложение поднимается, эта часть просто не работает (warning в лог).

**Bootstrap отдельно от хендлеров, входящие отдельно от исходящих:** `telegram-bot.service.ts`
(только запуск: приватный `startBot()` поднимает оба бота, `handleUpdate(target, update)`),
`telegram-notify.service.ts` (исходящие, свой модуль), `telegram-auth.service.ts` (вход через
Telegram), `phone-auth.service.ts` (вход по номеру), `telegram-link.service.ts`
(привязка/отвязка продавца), `handlers/{seller,customer}.composer.ts` — по композеру на бот,
цепочек `next()` между ними больше нет.

**Почему исходящие вынесены.** `OrdersModule` шлёт уведомления, а `seller.composer` зовёт
`OrdersService` — прямой цикл модулей. Он разорван тем, что `TelegramNotifyService` держит
собственные `Api` (это просто HTTP-клиенты к Bot API), а не инстансы `Bot`. Иначе нужен
`forwardRef`. Методы разведены по адресату — `sendToCustomer` (по `telegramId`, основной бот)
и `sendToSeller`/`sendLocationToSeller` (по `staffTelegramId`, бот продавца), чтобы нельзя
было перепутать бот и id.

**Вебхуки.** `POST /telegram/webhook` — основной, `POST /telegram/webhook/seller` — продавца,
у каждого свой секрет (`TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_SELLER_WEBHOOK_SECRET`).
URL продавца производный: `${TELEGRAM_WEBHOOK_URL}/seller` — чтобы на проде не заводить ещё
одну переменную с почти тем же значением.

**Кабинет продавца — без Mini App**, на inline-клавиатурах: активные заказы, «в доставке»,
карточка заказа и URL-кнопкой «Открыть в админке» (`ADMIN_URL`). Кабинет **read-only**:
кнопок статусов у карточки нет, колбэк `ord:<id>:<status>` убран вместе с ними — статус меняет
только `SUPER_ADMIN` из админки, иначе запрет обходился бы в два клика через бота. Старые
кнопки в истории чата (если остались с прошлой версии) просто не находят обработчик — grammy
их молча игнорирует. `/start` без payload от не-продавца — подсказка «вам в @<основной бот>».
Кабинет одинаков для всей команды: `resolveSeller` ищет юзера по `staffTelegramId` и требует
лишь роль + `sellerId`, поэтому сотрудник получает его без единой правки в композере.

> **`callback_data` — данные от клиента:** её можно подделать или нажать кнопку из
> пересланного сообщения. Поэтому роль и принадлежность заказа проверяются заново на **каждый**
> колбэк (`sel:list:*`, `sel:show:*`) — хотя менять тут всё равно нечего, кабинет только читает.

**Привязка продавца.** В админку он входит по email/паролю, `staffTelegramId` обычно `null`.
`POST /admin/auth/telegram/link` → `BotLinkSession(SELLER_LINK)` → ссылка/QR на
`t.me/<бот продавца>?start=sel_<nonce>`. `linkSeller` → `ok | expired | takenByStaff`:
владельца `staffTelegramId` он смотрит **до** апдейта, потому что P2002 знает только «занято»
(P2002 — бэкстоп на гонку). `POST …/telegram/unlink` обнуляет `staffTelegramId`: уведомления
молча перестают уходить, привязаться можно заново.

**Привязка сотрудника — инвайт-ссылкой, а не его собственным входом в админку.**
`POST /admin/sellers/:sellerId/staff/:staffId/telegram/invite` выписывает ту же
`BotLinkSession(SELLER_LINK)`, но на **чужой** `userId` — `TelegramLinkService.createSession`
принимает его параметром, так что новый флоу не понадобился. Сотруднику остаётся открыть
ссылку/QR у себя в Telegram; пароль ему можно вообще не заводить. Ради этого
`TelegramLinkService` вынесен в собственный `TelegramLinkModule` (как и `TelegramNotifyModule`):
`SellersModule` не может импортировать весь `TelegramModule` — тот тянет `OrdersModule`, вышел
бы цикл.

**Покупатель и staff — разные учётки, даже если Telegram один.** `telegramId` — адрес
покупателя в основном боте (и якорь входа в мобилку), `staffTelegramId` — адрес кабинета в
боте продавца; обе колонки unique, но независимы, поэтому совмещение ролей разрешено и
никаких проверок «это staff, не пускаем» больше нет (`src/common/telegram-identity.ts`).
Раньше колонка была одна и запрет был нужен, иначе выходило молчаливое слияние личностей:
заказы и телефон покупателя ложились в учётку продавца. Оставшийся инвариант — один Telegram
= максимум один покупатель и максимум один staff-аккаунт. Автоотвязки у покупателя нет
намеренно: `telegramId` — вход в его учётку, обнуление осиротило бы заказы и корзину.

## Аутентификация

**Мобилка — JWT (Bearer), access + refresh.** Защита `JwtAuthGuard` (`JWT_ACCESS_SECRET`).
Payload узкий — только `sub`/`role`/`sellerId` (`AuthPrincipal`): профильные поля
редактируемые и в токене протухали бы после `PATCH /me`, поэтому `GET /mobile/auth/me` читает
БД, а не claims. `POST /mobile/auth/refresh` — ротация (старый гасится, выдаётся новая пара);
в БД `sha256` от токена, в payload `jti`. `POST /mobile/auth/logout` отзывает refresh.

**Вход — только через основной бот**, он же и регистрация. Три пути в `AuthService.issueTokens`:

1. *nonce + polling* — `POST /mobile/auth/telegram/session` → `{ nonce, botUrl, expiresIn }`,
   бот ловит `/start <nonce>`, `GET …/session/:nonce` отдаёт `pending | expired | confirmed` +
   токены. Токены выдаются **ровно один раз**: `consumedAt` ставится условным `updateMany`
   (`where consumedAt: null`), поэтому гонка двух поллеров не выдаст две пары.
2. *Mini App* — `POST /mobile/auth/telegram/miniapp { initData }`. Подпись проверяется вручную
   на `node:crypto` (`secret = HMAC("WebAppData", botToken)`, сверка `hash`, свежесть
   `auth_date`) — библиотека ради 15 строк не нужна.
3. *По номеру телефона* — `PhoneAuthService`, см. ниже.

**Вход по номеру (`src/telegram/phone-auth.service.ts`, `PhoneAuthSession`).**
`POST /mobile/auth/phone/session { phone }` → `{ nonce, botUrl, expiresIn, codeSent }` →
`/start otp_<nonce>` в основном боте → бот показывает кнопку **«Поделиться номером»**
(`request_contact`) → `GET …/phone/session/:nonce` отдаёт `pending | code_sent | mismatch |
expired` → `POST …/phone/verify { nonce, code }` → токены (тот же однократный claim).

⚠️ Ключевое: **введённый номер сам по себе ничего не доказывает** — иначе любой занял бы
чужой (`phone` unique и уходит в снапшоты заказов). Настоящий номер даёт Telegram в
`message:contact`, мы сверяем его с заявленным, и только при совпадении шлём 6-значный код.
Контакт принимается лишь свой (`contact.user_id === from.id`, чужой можно переслать),
несовпадение гасит сессию (`mismatch`), 5 неверных кодов — тоже. Анти-флуд свой,
на подсчёте сессий по номеру (throttler в проекте нет): 5 за 15 минут → **429**.

Коллизии решаются строго, без слияния учёток: юзер по `telegramId` → дописываем ему `phone`;
юзера нет, но номер занят учёткой **без** `telegramId` → привязываем; номер занят учёткой с
другим `telegramId` → **409**; никого нет → создаём.

**Тестовый аккаунт Play Store.** `TEST_LOGIN_PHONE` + `TEST_LOGIN_OTP` (работает, только если
заданы **обе**): с этим номером `phone/session` не создаёт ссылку на бота, а сразу отдаёт
`botUrl: null, codeSent: true`, и `phone/verify` принимает вечный код. У ревьюера Google нет
доступа к нашему боту — без этой ветки верификацию не пройти. Юзер под тест-номер заводится
лениво, при первом входе (сид намеренно содержит только супер-админа).

Мобилке он виден по флагу **`isTest`** в `AuthUser` (`GET /mobile/auth/me`, там же и ответ
`PATCH /me`, и `GET /admin/auth/me`). Считается в одном месте — `isTestAccount`
(`src/common/test-account.ts`, зовёт `AuthService.toAuthUser`): совпадение `User.phone` с
`TEST_LOGIN_PHONE` при заданных **обеих** env. Колонки в БД нет намеренно — флаг целиком
выводится из env + номера. ⚠️ Из этого следует **запрет на правку профиля**: `updateProfile`
отдаёт тестовому аккаунту **403** на любой `PATCH /mobile/auth/me`, иначе сменой телефона он
перестал бы быть тестовым, а следующий вход по `TEST_LOGIN_PHONE` завёл бы новую учётку.
Проверка в сервисе, а не в контроллере, — чтобы её нельзя было обойти мимо метода.

`PATCH /mobile/auth/me` — `{ name?, phone?, email? }`, пустая строка очищает поле, занятые
`phone`/`email` → **409** (`updateProfile` разбирает `e.meta.target` из P2002), тестовый
аккаунт → **403**.

⚠️ **Телефон заполняется ровно один раз и дальше неизменяем** (**403** на попытку сменить или
очистить; прислать тот же номер можно — клиент шлёт форму целиком, сверка идёт по
`normalizePhone`, и значение в БД при этом не переписывается). Причина: подтверждения номера в
этом эндпоинте нет — настоящий номер даёт только Telegram (`PhoneAuthService`), — а `phone`
уникален, уходит в снапшоты заказов и служит контактом курьеру; свободный `PATCH` позволял бы
занять чужой номер или увести у себя вход по номеру. Пустой `phone` дозаполнить можно, это и
есть тот единственный раз; бэкфилл из checkout работает по тому же правилу (`!user.phone`).

### Удаление аккаунта

`DELETE /mobile/auth/me` → **204** (`UsersService.deleteAccount`). Требование Google Play:
приложение с регистрацией обязано уметь удалять учётку изнутри. Веб-страница запроса —
https://privacy.egen.uz/delete-account (репозиторий `egen-policy`), она же указана в форме
Data Safety.

⚠️ **Строку `users` не удаляем, а обезличиваем.** `Order.userId` стоит `onDelete: Restrict`
намеренно: заказы обязаны пережить уход покупателя ради отчётности продавца. Поэтому в одной
транзакции: удаляются `savedAddresses`/`cartItems`/`notifications`/`refreshTokens`/`pushTokens`
и незавершённые сессии входа (`telegramAuthSession`/`botLinkSession`/`phoneAuthSession` — живая
сессия иначе восстановила бы привязку), в группах заказов (`OrderGroup`, не `Order` — снапшот
переехал туда) затирается контактный снапшот (`contactName` → «Удалённый пользователь»,
`contactPhone`/`deliveryAddress` → пусто, `deliveryComment`/`deliveryLat`/`deliveryLng` →
null), а у юзера обнуляются
`telegramId`/`staffTelegramId`/`phone`/`email`/`name`/`passwordHash` и ставится `deletedAt`.
Эти колонки nullable+unique, поэтому обнуление **освобождает** их: повторный вход по тому же
номеру создаст новую учётку.

Отсюда два следствия, которые легко забыть:

- `findByPhone`/`findByEmail`/`findByTelegramId` ходят через `findFirst` c `deletedAt: null`,
  а не `findUnique` — иначе оставшийся хвост воскресил бы удалённую учётку;
- `JwtStrategy.validate` **делает запрос в БД** и кидает 401 при `deletedAt`. Один select по
  первичному ключу на авторизованный вызов — плата за то, что уже выданный access-токен живёт
  до конца TTL и без этой проверки удалённый аккаунт всё это время оставался бы рабочим.

**409, если есть заказы в нетерминальных статусах** («сначала завершите или отмените»): без
телефона и адреса курьер не доедет. Список статусов выводится из `ALLOWED_TRANSITIONS` через
`isTerminal`, второй копии карты переходов не заводим. Тестовому аккаунту → **403**, повторный
вызов на уже удалённом — идемпотентный no-op.

Боты: `TELEGRAM_USE_WEBHOOK=false` → long-polling (dev), `true` → `setWebhook` + контроллер.
Пустой `TELEGRAM_BOT_TOKEN` → приложение поднимается, основной бот не стартует (warning),
входа нет.

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
  `seller`, `settings`); админские списки — никогда. Пустой `REDIS_URL` → кэш выключен.
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
- боты — **только webhook** (оба, режим общий): при редеплое и нескольких репликах два
  поллера конфликтуют.
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
- после мутации каталога витрина сразу отдаёт свежие данные (значит `bump()` не забыт);
- уведомления покупателя считаются по группе: чекаут у двух продавцов, переведённый в
  `CONFIRMED` целиком, даёт **одну** строку в `/mobile/notifications` (`ORDER_GROUP_STATUS_CHANGED`,
  `{ groupId, groupNumber, status }`) и **один** пуш; смена статуса одного заказа, не сдвинувшая
  `deriveGroupStatus`, не даёт ничего; повторный `PATCH …/group-status` тем же статусом — тоже;
  самоотмена пишет строку в ленту, но не шлёт покупателю ни пуша, ни сообщения в бот;
- вход по номеру: чужой пересланный контакт и контакт с другим номером → отказ (`mismatch`),
  верный код логинит, повтор того же `phone/verify` → 401, 6 сессий на номер за 15 мин → 429;
- с заданными `TEST_LOGIN_PHONE`/`TEST_LOGIN_OTP` вход по тест-номеру проходит **не открывая
  Telegram** (`botUrl: null`, `codeSent: true`); с пустыми env тот же номер идёт обычным путём;
- тест-аккаунт: `GET /mobile/auth/me` → `isTest: true`, любой `PATCH /mobile/auth/me` → **403**
  (у обычного юзера `isTest: false` и правка профиля работает как раньше);
- телефон: юзеру с пустым `phone` `PATCH /me` его проставляет, повторная смена → **403**,
  очистка (`phone: ""`) → **403**, отправка того же номера в другом формате → 200 и значение
  в БД не изменилось;
- один Telegram даёт две независимые учётки: вход в мобилку через основной бот и кабинет
  через бота продавца (заказ от покупательской учётки приходит продавцу в его бот);
- команда: новый заказ приходит **всем** сотрудникам с привязанным Telegram, а не только
  владельцу; заблокировавший бота сотрудник не мешает доставке остальным; сотрудник без
  привязки просто пропускается; рядовой сотрудник получает 403 на `…/staff`, владелец чужого
  продавца — тоже; владельца удалить нельзя (400).
