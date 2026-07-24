import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, OrderStatus, Prisma, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthPrincipal } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService } from '../addresses/addresses.service';
import { OrderNotifier } from './order-notifier.service';
import {
  CancelOrderDto,
  ChangeOrderStatusDto,
  CreateOrderDto,
  FindOrdersQueryDto,
  UpdateOrderCourierDto,
} from './dto/order.dto';
import { isTransitionAllowed, ORDER_STATUS_LABELS } from './order-status';

// Заказ всегда отдаётся целиком: позиции + история + продавец. Списки заказов
// короткие (это не витрина), поэтому отдельного «лёгкого» варианта не заводим.
const withDetails = {
  items: true,
  history: { orderBy: { createdAt: 'asc' } },
  seller: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{
  include: typeof withDetails;
}>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: OrderNotifier,
    private readonly addresses: AddressesService,
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
  ): Promise<OrderWithDetails[]> {
    const cartItems = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { listing: { include: { catalogItem: true } } },
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

    const groupId = randomUUID();
    const bySeller = new Map<string, typeof cartItems>();
    for (const item of cartItems) {
      const list = bySeller.get(item.listing.sellerId) ?? [];
      list.push(item);
      bySeller.set(item.listing.sellerId, list);
    }

    const orders = await this.prisma.$transaction(async (tx) => {
      const created: OrderWithDetails[] = [];

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
          (sum, item) =>
            sum.add(new Prisma.Decimal(item.listing.price).mul(item.quantity)),
          new Prisma.Decimal(0),
        );

        const order = await tx.order.create({
          data: {
            groupId,
            userId,
            sellerId,
            itemsTotal,
            // Доставка пока бесплатная: тарифов нет, поле заложено под курьерку.
            deliveryFee: 0,
            total: itemsTotal,
            contactName: dto.contactName,
            contactPhone: dto.contactPhone,
            deliveryAddress: addressSnapshot.address,
            deliveryComment: addressSnapshot.comment,
            deliveryLat: addressSnapshot.lat,
            deliveryLng: addressSnapshot.lng,
            savedAddressId: dto.savedAddressId,
            items: {
              create: items.map((item) => ({
                listingId: item.listingId,
                catalogItemName: item.listing.catalogItem.name,
                catalogItemImageUrl: item.listing.catalogItem.imageUrl,
                unit: item.listing.catalogItem.unit,
                price: item.listing.price,
                quantity: item.quantity,
                total: new Prisma.Decimal(item.listing.price).mul(
                  item.quantity,
                ),
              })),
            },
            history: { create: { status: OrderStatus.NEW } },
          },
          include: withDetails,
        });
        created.push(order);
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
      return created;
    });

    // Телефон в профиле мог быть пустым — дозаполняем из заказа. Номер уникален и
    // может принадлежать другому аккаунту: в этом случае молча пропускаем, снапшот
    // в заказе всё равно есть и доставке ничего не мешает.
    await this.backfillProfilePhone(userId, dto.contactName, dto.contactPhone);

    // Уведомления — строго после коммита и не блокируют ответ клиенту.
    await this.notifier.orderCreated(orders);

    return orders;
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

  async findMine(
    userId: string,
    query: FindOrdersQueryDto,
  ): Promise<CursorPage<OrderWithDetails>> {
    const rows = await this.prisma.order.findMany({
      where: { userId, status: query.status },
      include: withDetails,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOneMine(userId: string, id: string): Promise<OrderWithDetails> {
    const order = await this.findOrFail(id);
    if (order.userId !== userId) throw new ForbiddenException('Чужой заказ');
    return order;
  }

  /** Покупатель отменяет сам — только пока заказ не уехал. */
  async cancelMine(
    userId: string,
    id: string,
    dto: CancelOrderDto,
  ): Promise<OrderWithDetails> {
    const order = await this.findOneMine(userId, id);
    if (
      order.status !== OrderStatus.NEW &&
      order.status !== OrderStatus.CONFIRMED
    ) {
      throw new BadRequestException(
        'Заказ уже собирается — отмену согласуйте с продавцом',
      );
    }
    const updated = await this.applyStatus(order, OrderStatus.CANCELLED, {
      comment: dto.reason,
      changedByUserId: userId,
    });
    await this.notifier.cancelledByCustomer(updated);
    return updated;
  }

  // ───────────────────────────────── админка ─────────────────────────────────

  async findAllForStaff(
    user: AuthPrincipal,
    query: FindOrdersQueryDto,
  ): Promise<CursorPage<OrderWithDetails>> {
    const rows = await this.prisma.order.findMany({
      where: {
        ...this.staffScope(user, query.sellerId),
        status: query.status,
        ...searchFilter(query.search),
      },
      include: withDetails,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOneForStaff(
    user: AuthPrincipal,
    id: string,
  ): Promise<OrderWithDetails> {
    const order = await this.findOrFail(id);
    this.assertStaffAccess(user, order);
    return order;
  }

  /**
   * Смена статуса продавцом — и из админки, и из кабинета в Telegram-боте.
   * Обе поверхности обязаны ходить сюда, а не в prisma напрямую: тут и валидация
   * перехода, и запись в историю, и возврат остатка при отмене.
   */
  async changeStatus(
    user: AuthPrincipal,
    id: string,
    dto: ChangeOrderStatusDto,
  ): Promise<OrderWithDetails> {
    const order = await this.findOrFail(id);
    this.assertStaffAccess(user, order);

    if (!isTransitionAllowed(order.status, dto.status)) {
      throw new BadRequestException(
        `Нельзя перевести заказ из «${ORDER_STATUS_LABELS[order.status]}» в «${
          ORDER_STATUS_LABELS[dto.status]
        }»`,
      );
    }

    const updated = await this.applyStatus(order, dto.status, {
      comment: dto.comment,
      changedByUserId: user.id,
    });
    await this.notifier.statusChanged(updated);
    return updated;
  }

  async updateCourier(
    user: AuthPrincipal,
    id: string,
    dto: UpdateOrderCourierDto,
  ): Promise<OrderWithDetails> {
    const order = await this.findOrFail(id);
    this.assertStaffAccess(user, order);
    return this.prisma.order.update({
      where: { id },
      data: dto,
      include: withDetails,
    });
  }

  // ───────────────────────────────── общее ─────────────────────────────────

  /** Применяет статус + пишет историю + возвращает остаток при отмене. */
  private applyStatus(
    order: OrderWithDetails,
    status: OrderStatus,
    meta: { comment?: string; changedByUserId?: string },
  ): Promise<OrderWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      if (status === OrderStatus.CANCELLED) {
        await this.restock(tx, order);
      }
      return tx.order.update({
        where: { id: order.id },
        data: {
          status,
          confirmedAt:
            status === OrderStatus.CONFIRMED ? new Date() : undefined,
          deliveredAt:
            status === OrderStatus.DELIVERED ? new Date() : undefined,
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
        include: withDetails,
      });
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

  // SELLER видит только свои заказы; его sellerId в query игнорируется, чтобы
  // нельзя было подсмотреть чужие — та же схема, что в CategoriesService.
  private staffScope(
    user: AuthPrincipal,
    sellerId?: string,
  ): Prisma.OrderWhereInput {
    if (user.role === Role.SUPER_ADMIN) return { sellerId };
    if (!user.sellerId) {
      throw new ForbiddenException('Пользователь не привязан к продавцу');
    }
    return { sellerId: user.sellerId };
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

  /** Поиск в админке: по номеру заказа либо по телефону получателя. */
  async findByOrderNumber(
    user: AuthPrincipal,
    orderNumber: number,
  ): Promise<OrderWithDetails | null> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: withDetails,
    });
    if (!order) return null;
    this.assertStaffAccess(user, order);
    return order;
  }
}

function searchFilter(search?: string): Prisma.OrderWhereInput {
  if (!search) return {};
  const asNumber = Number(search.replace(/^#/, ''));
  return {
    OR: [
      ...(Number.isInteger(asNumber) ? [{ orderNumber: asNumber }] : []),
      { contactPhone: { contains: search } },
      { contactName: { contains: search, mode: 'insensitive' as const } },
    ],
  };
}
