import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingStatus,
  MediaStatus,
  MediaType,
  OrderGroupStatus,
  OrderStatus,
  Prisma,
  Role,
} from '@prisma/client';
import type { AuthPrincipal } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService } from '../addresses/addresses.service';
import { CacheService } from '../cache/cache.service';
import { SettingsService } from '../settings/settings.service';
import { OrderNotifier } from './order-notifier.service';
import {
  CancelOrderDto,
  ChangeOrderStatusDto,
  CreateOrderDto,
  FindOrderGroupsQueryDto,
  UpdateOrderCourierDto,
} from './dto/order.dto';
import {
  deriveGroupStatus,
  isTerminal,
  isTransitionAllowed,
  ORDER_STATUS_LABELS,
} from './order-status';

// Заказ всегда отдаётся целиком: позиции + история + продавец + группа чекаута
// (контакты и адрес живут только там). Списки заказов короткие (это не витрина),
// поэтому отдельного «лёгкого» варианта не заводим.
//
// group здесь нужен не для HTTP-ответа (OrderResponse его не несёт, см.
// order.response.ts), а для карточки в Telegram-боте — order-notifier.service.ts
// читает order.group.* (контакты, адрес).
const withDetails = {
  items: true,
  history: { orderBy: { createdAt: 'asc' } },
  seller: { select: { id: true, name: true } },
  group: true,
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{
  include: typeof withDetails;
}>;

// sellerId сужает orders группы до заказов конкретного продавца — вся изоляция
// SELLER в групповых чтениях держится на этом where, а не на пост-фильтрации
// ответа (см. groupStaffScope/sellerScopeId ниже).
// ⚠️ satisfies, а не аннотация возвращаемого типа: аннотация `: Prisma.OrderGroupInclude`
// схлопнула бы литеральный тип до общего union, и OrderGroupWithOrders потерял бы
// items/history/seller на вложенных orders (см. withDetails выше).
function withGroupOrders(sellerId?: string) {
  return {
    orders: {
      where: sellerId ? { sellerId } : undefined,
      include: withDetails,
      orderBy: { createdAt: 'asc' },
    },
    // Не фильтруется по sellerId, в отличие от orders выше: статус группы виден
    // продавцу целиком (см. toSellerOrderGroupResponse), значит и её история — тоже.
    history: { orderBy: { createdAt: 'asc' } },
  } satisfies Prisma.OrderGroupInclude;
}

export type OrderGroupWithOrders = Prisma.OrderGroupGetPayload<{
  include: ReturnType<typeof withGroupOrders>;
}>;

// Обложка для снапшота позиции заказа. В галерее первым может стоять видео, а в
// карточке заказа (админка, бот, история покупателя) нужна картинка — берём первое
// фото, иначе обложку первого видео.
function coverUrl(
  media: { type: MediaType; url: string; posterUrl: string | null }[],
): string | null {
  const image = media.find((m) => m.type === MediaType.IMAGE);
  if (image) return image.url;
  return media.find((m) => m.posterUrl)?.posterUrl ?? null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: OrderNotifier,
    private readonly addresses: AddressesService,
    private readonly cache: CacheService,
    private readonly settings: SettingsService,
  ) {}

  // ─────────────────────────────── создание ───────────────────────────────

  /**
   * Оформление корзины. Один checkout режется на несколько заказов — по одному
   * на продавца, связанных общим groupId (стандарт маркетплейсов: у каждого
   * продавца своя сборка и своя доставка).
   */
  async createFromCart(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderGroupWithOrders> {
    const cartItems = await this.prisma.cartItem.findMany({
      where: { userId },
      include: {
        listing: {
          include: {
            catalogItem: {
              // Вся готовая галерея, а не take: 1 — в снапшот заказа нужна
              // картинка, а первым медиа может оказаться видео (см. coverUrl).
              include: {
                media: {
                  where: { status: MediaStatus.READY },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (cartItems.length === 0) {
      throw new BadRequestException('Корзина пуста');
    }

    // savedAddressId — источник правды для снапшота ниже, сырые deliveryAddress/...
    // в этом случае игнорируются (клиент их и не шлёт, см. CreateOrderDto).
    const addressSnapshot = dto.savedAddressId
      ? await this.resolveSavedAddress(userId, dto.savedAddressId)
      : {
          address: dto.deliveryAddress,
          comment: dto.deliveryComment,
          lat: dto.deliveryLat,
          lng: dto.deliveryLng,
        };

    // Проверяем доступность до транзакции, чтобы отдать понятную ошибку с названием
    // товара. Финальную защиту от гонки даёт условный decrement ниже.
    for (const item of cartItems) {
      const { listing } = item;
      const name = listing.catalogItem.name;
      if (listing.status !== ListingStatus.ACTIVE) {
        throw new BadRequestException(`«${name}» больше не продаётся`);
      }
      if (item.quantity > listing.stock) {
        throw new BadRequestException(
          `«${name}»: в наличии только ${listing.stock}`,
        );
      }
    }

    const bySeller = new Map<string, typeof cartItems>();
    for (const item of cartItems) {
      const list = bySeller.get(item.listing.sellerId) ?? [];
      list.push(item);
      bySeller.set(item.listing.sellerId, list);
    }

    const checkoutTotal = cartItems.reduce(
      (sum, item) => sum + item.listing.price * item.quantity,
      0,
    );
    // Тариф снапшотится в группу на момент оформления: смена настроек не должна
    // менять уже созданные заказы.
    const quote = await this.settings.quote(checkoutTotal, {
      allFreeDelivery: cartItems.every(
        (item) => item.listing.catalogItem.freeDelivery,
      ),
    });

    const group = await this.prisma.$transaction(async (tx) => {
      const group = await tx.orderGroup.create({
        data: {
          userId,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          deliveryAddress: addressSnapshot.address,
          deliveryComment: addressSnapshot.comment,
          deliveryLat: addressSnapshot.lat,
          deliveryLng: addressSnapshot.lng,
          savedAddressId: dto.savedAddressId,
          itemsTotal: quote.itemsTotal,
          deliveryFee: quote.deliveryFee,
          total: quote.total,
          history: { create: { status: OrderGroupStatus.NEW } },
        },
      });

      for (const [sellerId, items] of bySeller) {
        for (const item of items) {
          // Условный decrement: если между проверкой выше и этим апдейтом кто-то
          // выкупил остаток, count === 0 и вся транзакция откатывается. Тот же
          // приём, что claim сессии в TelegramAuthService.poll.
          const claimed = await tx.listing.updateMany({
            where: { id: item.listingId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (claimed.count === 0) {
            throw new BadRequestException(
              `«${item.listing.catalogItem.name}» разобрали, пока вы оформляли заказ`,
            );
          }
        }

        const itemsTotal = items.reduce(
          (sum, item) => sum + item.listing.price * item.quantity,
          0,
        );

        await tx.order.create({
          data: {
            groupId: group.id,
            userId,
            sellerId,
            itemsTotal,
            items: {
              create: items.map((item) => ({
                listingId: item.listingId,
                catalogItemName: item.listing.catalogItem.name,
                catalogItemImageUrl: coverUrl(item.listing.catalogItem.media),
                unit: item.listing.catalogItem.unit,
                price: item.listing.price,
                quantity: item.quantity,
                total: item.listing.price * item.quantity,
              })),
            },
            history: { create: { status: OrderStatus.NEW } },
          },
        });
      }

      // Один раз на весь чекаут (не на каждого продавца), внутри той же транзакции —
      // конфликтов уникальности тут нет, в отличие от бэкфилла телефона ниже.
      if (dto.saveAddress && !dto.savedAddressId) {
        await tx.savedAddress.create({
          data: {
            userId,
            label: null,
            address: addressSnapshot.address,
            comment: addressSnapshot.comment,
            lat: addressSnapshot.lat,
            lng: addressSnapshot.lng,
          },
        });
      }

      await tx.cartItem.deleteMany({ where: { userId } });

      return tx.orderGroup.findUniqueOrThrow({
        where: { id: group.id },
        include: withGroupOrders(),
      });
    });

    // Остаток списан — витрина (фильтр stock > 0 и сам остаток в карточке) устарела.
    // Строго после коммита: bump внутри транзакции сбросил бы кеш до того, как
    // новые остатки стали видны, и кеш перезаполнился бы старыми данными.
    await this.cache.bump();

    // Телефон в профиле мог быть пустым — дозаполняем из заказа. Номер уникален и
    // может принадлежать другому аккаунту: в этом случае молча пропускаем, снапшот
    // в заказе всё равно есть и доставке ничего не мешает.
    await this.backfillProfilePhone(userId, dto.contactName, dto.contactPhone);

    // Уведомления — строго после коммита и не блокируют ответ клиенту.
    await this.notifier.orderCreated(group.orders);
    // Отдельно, одной сводной карточкой на всю группу — платформенным SUPER_ADMIN.
    await this.notifier.groupCreatedForSuperAdmins(group);

    return group;
  }

  private async resolveSavedAddress(
    userId: string,
    savedAddressId: string,
  ): Promise<{
    address: string;
    comment?: string;
    lat?: number;
    lng?: number;
  }> {
    const saved = await this.addresses.findOwned(userId, savedAddressId);
    return {
      address: saved.address,
      comment: saved.comment ?? undefined,
      lat: saved.lat ?? undefined,
      lng: saved.lng ?? undefined,
    };
  }

  private async backfillProfilePhone(
    userId: string,
    name: string,
    phone: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const data: Prisma.UserUpdateInput = {};
    if (!user.phone) data.phone = phone;
    if (!user.name) data.name = name;
    if (Object.keys(data).length === 0) return;

    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `Телефон ${phone} уже привязан к другому аккаунту — профиль ${userId} не обновлён.`,
        );
        return;
      }
      throw error;
    }
  }

  // ──────────────────────────────── мобилка ────────────────────────────────
  // API покупателя: заказ — это группа (см. AGENTS.md «Заказы»). Плоских
  // /mobile/orders больше нет.

  async findMyGroups(
    userId: string,
    query: FindOrderGroupsQueryDto,
  ): Promise<CursorPage<OrderGroupWithOrders>> {
    const rows = await this.prisma.orderGroup.findMany({
      where: { userId, ...groupStatusFilter(query.status) },
      include: withGroupOrders(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOneMyGroup(
    userId: string,
    id: string,
  ): Promise<OrderGroupWithOrders> {
    const group = await this.findGroupOrFail(id);
    if (group.userId !== userId) throw new ForbiddenException('Чужой заказ');
    return group;
  }

  /**
   * Покупатель отменяет ЧЕКАУТ, а не часть его. Если хотя бы один продавец начал
   * сборку, отмену запрещаем целиком: частичной отмены в UI нет, и «отменил, а
   * половина всё равно приедет» — худший из возможных исходов.
   */
  async cancelMyGroup(
    userId: string,
    id: string,
    dto: CancelOrderDto,
  ): Promise<OrderGroupWithOrders> {
    const group = await this.findOneMyGroup(userId, id);
    const active = group.orders.filter((o) => !isTerminal(o.status));
    if (active.length === 0) {
      throw new BadRequestException('Заказ уже завершён');
    }
    if (
      active.some(
        (o) =>
          o.status !== OrderStatus.NEW && o.status !== OrderStatus.CONFIRMED,
      )
    ) {
      throw new BadRequestException(
        'Заказ уже собирается — отмену согласуйте с продавцом',
      );
    }

    // ⚠️ ОДНА транзакция на всю группу. Вызов applyStatus в цикле дал бы N
    // транзакций: упавшая вторая оставила бы первый заказ отменённым — ровно та
    // частичная отмена, которую мы только что запретили. applyStatusTx —
    // приватная половина applyStatus без собственной транзакции, для такого
    // переиспользования.
    await this.prisma.$transaction(async (tx) => {
      for (const order of active) {
        await this.applyStatusTx(tx, order, OrderStatus.CANCELLED, {
          comment: dto.reason,
          changedByUserId: userId,
        });
      }
    });
    // Остатки вернулись — строго после коммита.
    await this.cache.bump();

    const updated = await this.findOneMyGroup(userId, id);
    // Только те заказы, которые отменила ЭТА операция: заказ, уже отменённый
    // админом раньше, не должен второй раз дёргать своего продавца.
    for (const order of updated.orders.filter((o) =>
      active.some((a) => a.id === o.id),
    )) {
      await this.notifier.cancelledByCustomer(order);
    }
    // Покупателю — только строка в ленте: push и DM были бы уведомлением о его
    // же нажатии секунду назад.
    if (updated.status !== group.status) {
      await this.notifier.groupStatusChanged(updated, { feedOnly: true });
    }
    return updated;
  }

  // ───────────────────────────────── админка ─────────────────────────────────

  async findGroupsForStaff(
    user: AuthPrincipal,
    query: FindOrderGroupsQueryDto,
  ): Promise<CursorPage<OrderGroupWithOrders>> {
    const rows = await this.prisma.orderGroup.findMany({
      where: {
        ...this.groupStaffScope(user, query.sellerId),
        ...groupStatusFilter(query.status),
        ...groupSearchFilter(query.search),
      },
      include: withGroupOrders(this.sellerScopeId(user)),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOneGroupForStaff(
    user: AuthPrincipal,
    id: string,
  ): Promise<OrderGroupWithOrders> {
    const group = await this.findGroupOrFail(id, this.sellerScopeId(user));
    // SELLER не участвует в этой группе — существование чужой группы ему не
    // подтверждаем, поэтому 404, а не 403.
    if (group.orders.length === 0) {
      throw new NotFoundException('Заказ не найден');
    }
    return group;
  }

  /**
   * Смена статуса — теперь только SUPER_ADMIN, и из админки, и (гипотетически)
   * из бота: у кабинета продавца кнопки статусов убраны (см. seller.composer.ts),
   * иначе запрет обходился бы в два клика.
   */
  async changeStatus(
    user: AuthPrincipal,
    id: string,
    dto: ChangeOrderStatusDto,
  ): Promise<OrderGroupWithOrders> {
    this.assertSuperAdmin(user);
    const order = await this.findOrFail(id);

    if (!isTransitionAllowed(order.status, dto.status)) {
      throw new BadRequestException(
        `Нельзя перевести заказ из «${ORDER_STATUS_LABELS[order.status]}» в «${
          ORDER_STATUS_LABELS[dto.status]
        }»`,
      );
    }

    // Статус группы выводится из статусов её заказов, поэтому смена одного Order
    // может как сдвинуть его, так и не сдвинуть (сосед всё ещё позади). Сравнение
    // «до/после коммита» — то же условие, по которому пишется история группы.
    const groupStatusBefore = order.group.status;
    const updated = await this.applyStatus(order, dto.status, {
      comment: dto.comment,
      changedByUserId: user.id,
    });

    const group = await this.findOneGroupForStaff(user, updated.groupId);
    if (group.status !== groupStatusBefore) {
      await this.notifier.groupStatusChanged(group);
    }
    return group;
  }

  /**
   * Смена статуса ГРУППЫ целиком — SUPER_ADMIN, каскадом на все её нетерминальные
   * заказы. OrderGroup.status по-прежнему не пишется напрямую: applyStatusTx
   * внутри цикла пересчитывает его через deriveGroupStatus, как и везде —
   * второй карты переходов тут нет, используется тот же ALLOWED_TRANSITIONS.
   * Одна транзакция на всю группу по тем же причинам, что в cancelMyGroup:
   * частичный каскад хуже, чем явный отказ.
   */
  async changeGroupStatus(
    user: AuthPrincipal,
    groupId: string,
    dto: ChangeOrderStatusDto,
  ): Promise<OrderGroupWithOrders> {
    this.assertSuperAdmin(user);
    const group = await this.findGroupOrFail(groupId);

    const active = group.orders.filter((o) => !isTerminal(o.status));
    if (active.length === 0) {
      throw new BadRequestException('Все заказы группы уже завершены');
    }

    const toChange = active.filter((o) => o.status !== dto.status);
    if (toChange.length === 0) {
      // Все нетерминальные заказы уже в целевом статусе — идемпотентный no-op.
      return group;
    }

    const blocked = toChange.filter(
      (o) => !isTransitionAllowed(o.status, dto.status),
    );
    if (blocked.length > 0) {
      const details = blocked
        .map(
          (o) =>
            `#${o.orderNumber} (${o.seller.name}): «${ORDER_STATUS_LABELS[o.status]}»`,
        )
        .join(', ');
      throw new BadRequestException(
        `Нельзя перевести всю группу в «${ORDER_STATUS_LABELS[dto.status]}» — блокируют заказы: ${details}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const order of toChange) {
        await this.applyStatusTx(tx, order, dto.status, {
          comment: dto.comment,
          changedByUserId: user.id,
        });
      }
    });

    if (dto.status === OrderStatus.CANCELLED) {
      await this.cache.bump();
    }

    const updated = await this.findOneGroupForStaff(user, groupId);
    // Одно уведомление на весь каскад: покупателю переезд трёх заказов группы в
    // DELIVERING — это одно событие «заказ едет», а не три с разными номерами.
    if (updated.status !== group.status) {
      await this.notifier.groupStatusChanged(updated);
    }
    return updated;
  }

  async updateCourier(
    user: AuthPrincipal,
    id: string,
    dto: UpdateOrderCourierDto,
  ): Promise<OrderGroupWithOrders> {
    this.assertSuperAdmin(user);
    const order = await this.findOrFail(id);
    await this.prisma.order.update({ where: { id }, data: dto });
    return this.findOneGroupForStaff(user, order.groupId);
  }

  /**
   * Единственный оставшийся потребитель — карточка-просмотр в кабинете продавца
   * в Telegram-боте (`sel:show:<id>`, seller.composer.ts): бот показывает один
   * Order, а не целую группу, и остаётся доступен SELLER на чтение (менять
   * статус он больше не может — см. changeStatus).
   */
  async findOneForStaff(
    user: AuthPrincipal,
    id: string,
  ): Promise<OrderWithDetails> {
    const order = await this.findOrFail(id);
    this.assertStaffAccess(user, order);
    return order;
  }

  // ───────────────────────────────── общее ─────────────────────────────────

  /** Применяет статус + пишет историю + возвращает остаток при отмене. Своя транзакция. */
  private async applyStatus(
    order: OrderWithDetails,
    status: OrderStatus,
    meta: { comment?: string; changedByUserId?: string },
  ): Promise<OrderWithDetails> {
    const updated = await this.prisma.$transaction((tx) =>
      this.applyStatusTx(tx, order, status, meta),
    );

    // Отмена вернула остаток в продажу — витрина устарела. Строго после коммита.
    if (status === OrderStatus.CANCELLED) {
      await this.cache.bump();
    }
    return updated;
  }

  /**
   * То же самое, но внутри ЧУЖОЙ транзакции — переиспользуется cancelMyGroup,
   * которой нужно отменить несколько заказов одним коммитом (см. предупреждение
   * там). Кэш здесь не бампается — это ответственность вызывающего.
   */
  private async applyStatusTx(
    tx: Prisma.TransactionClient,
    order: OrderWithDetails,
    status: OrderStatus,
    meta: { comment?: string; changedByUserId?: string },
  ): Promise<OrderWithDetails> {
    if (status === OrderStatus.CANCELLED) {
      await this.restock(tx, order);
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        status,
        confirmedAt: status === OrderStatus.CONFIRMED ? new Date() : undefined,
        deliveredAt: status === OrderStatus.DELIVERED ? new Date() : undefined,
        cancelReason:
          status === OrderStatus.CANCELLED ? meta.comment : undefined,
        history: {
          create: {
            status,
            comment: meta.comment,
            changedByUserId: meta.changedByUserId,
          },
        },
      },
    });

    // Статус группы выводится из статусов её заказов — ни одна поверхность не
    // пишет его напрямую (см. deriveGroupStatus в src/orders/order-status.ts).
    const siblingStatuses = await tx.order.findMany({
      where: { groupId: order.groupId },
      select: { status: true },
    });
    const derivedStatus = deriveGroupStatus(
      siblingStatuses.map((s) => s.status),
    );

    // История группы пишется только на РЕАЛЬНОЕ изменение выведенного статуса, а не
    // на каждый вызов applyStatusTx — иначе каскад по нескольким заказам группы за
    // одну операцию (changeGroupStatus, cancelMyGroup) плодил бы запись на каждый
    // задетый заказ вместо одной на фактический переход.
    const currentGroup = await tx.orderGroup.findUniqueOrThrow({
      where: { id: order.groupId },
      select: { status: true },
    });
    await tx.orderGroup.update({
      where: { id: order.groupId },
      data: {
        status: derivedStatus,
        history:
          derivedStatus !== currentGroup.status
            ? {
                create: {
                  status: derivedStatus,
                  comment: meta.comment,
                  changedByUserId: meta.changedByUserId,
                },
              }
            : undefined,
      },
    });

    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: withDetails,
    });
  }

  // Отменённый заказ возвращает товар в продажу. listingId может быть null,
  // если листинг удалили — тогда возвращать некуда.
  private async restock(
    tx: Prisma.TransactionClient,
    order: OrderWithDetails,
  ): Promise<void> {
    for (const item of order.items) {
      if (!item.listingId) continue;
      await tx.listing.update({
        where: { id: item.listingId },
        data: { stock: { increment: item.quantity } },
      });
    }
  }

  private async findOrFail(id: string): Promise<OrderWithDetails> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: withDetails,
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  private async findGroupOrFail(
    id: string,
    sellerId?: string,
  ): Promise<OrderGroupWithOrders> {
    const group = await this.prisma.orderGroup.findUnique({
      where: { id },
      include: withGroupOrders(sellerId),
    });
    if (!group) throw new NotFoundException('Заказ не найден');
    return group;
  }

  private assertSuperAdmin(user: AuthPrincipal): void {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Статус заказа меняет только SUPER_ADMIN');
    }
  }

  private assertStaffAccess(
    user: AuthPrincipal,
    order: OrderWithDetails,
  ): void {
    if (user.role === Role.SUPER_ADMIN) return;
    if (!user.sellerId || order.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужой заказ');
    }
  }

  // undefined для SUPER_ADMIN — он видит все заказы внутри группы независимо от
  // query.sellerId (тот фильтрует, КАКИЕ ГРУППЫ попали в выборку, а не какие
  // заказы внутри них видны). Для SELLER — всегда свой sellerId.
  private sellerScopeId(user: AuthPrincipal): string | undefined {
    return user.role === Role.SUPER_ADMIN
      ? undefined
      : (user.sellerId ?? undefined);
  }

  // SELLER видит только группы, где участвует хотя бы один его заказ; его query
  // sellerId игнорируется — та же схема, что в CategoriesService.
  private groupStaffScope(
    user: AuthPrincipal,
    sellerId?: string,
  ): Prisma.OrderGroupWhereInput {
    if (user.role === Role.SUPER_ADMIN) {
      return sellerId ? { orders: { some: { sellerId } } } : {};
    }
    if (!user.sellerId) {
      throw new ForbiddenException('Пользователь не привязан к продавцу');
    }
    return { orders: { some: { sellerId: user.sellerId } } };
  }
}

function groupStatusFilter(
  status?: OrderGroupStatus[],
): Prisma.OrderGroupWhereInput {
  if (!status?.length) return {};
  return { status: status.length === 1 ? status[0] : { in: status } };
}

/** Поиск в админке: по номеру группы, номеру заказа внутри неё, телефону или имени. */
function groupSearchFilter(search?: string): Prisma.OrderGroupWhereInput {
  if (!search) return {};
  const asNumber = Number(search.replace(/^#/, ''));
  const numeric = Number.isInteger(asNumber) ? asNumber : undefined;
  return {
    OR: [
      ...(numeric !== undefined ? [{ groupNumber: numeric }] : []),
      ...(numeric !== undefined
        ? [{ orders: { some: { orderNumber: numeric } } }]
        : []),
      { contactPhone: { contains: search } },
      { contactName: { contains: search, mode: 'insensitive' as const } },
    ],
  };
}
