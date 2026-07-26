import { Injectable } from '@nestjs/common';
import { NotificationType, OrderStatus, Prisma } from '@prisma/client';
import type { Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Полезная нагрузка ORDER_STATUS_CHANGED — по ней клиент рендерит текст и решает, что перезапросить. */
export interface OrderStatusChangedPayload {
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
}

/** Страница ленты. cursor отдаём ВСЕГДА, в том числе при пустом items: клиент не должен считать max(seq) сам. */
export interface NotificationsPage {
  items: Notification[];
  cursor: number;
  unreadCount: number;
}

export const NOTIFICATIONS_DEFAULT_LIMIT = 50;

/**
 * Лента уведомлений покупателя.
 *
 * Ничего не знает ни о заказах, ни о Telegram — только пишет и отдаёт строки.
 * Благодаря этому OrdersModule импортирует её без риска цикла (в отличие от
 * TelegramNotifyService, ради которого пришлось разносить bootstrap и исходящие).
 *
 * Всё скоупится по userId, как в CartService/AddressesService: id уведомления
 * приходит от клиента и сам по себе ничего не доказывает.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  emit(
    userId: string,
    type: NotificationType,
    payload: Prisma.InputJsonValue,
  ): Promise<Notification> {
    return this.prisma.notification.create({ data: { userId, type, payload } });
  }

  orderStatusChanged(
    userId: string,
    payload: OrderStatusChangedPayload,
  ): Promise<Notification> {
    return this.emit(userId, NotificationType.ORDER_STATUS_CHANGED, {
      ...payload,
    });
  }

  /**
   * Страница ленты для поллинга.
   *
   * С `after` — только новое (seq > after) по возрастанию.
   * Без `after` — бутстрап свежего клиента: последние `limit` записей. Их клиент
   * показывает как уже прочитанную ленту и НЕ тостит — иначе при каждом открытии
   * приложения вываливалась бы вся история.
   */
  async page(
    userId: string,
    after?: number,
    limit: number = NOTIFICATIONS_DEFAULT_LIMIT,
  ): Promise<NotificationsPage> {
    const items =
      after == null
        ? await this.prisma.notification
            .findMany({
              where: { userId },
              orderBy: { seq: 'desc' },
              take: limit,
            })
            .then((rows) => rows.reverse())
        : await this.prisma.notification.findMany({
            where: { userId, seq: { gt: after } },
            orderBy: { seq: 'asc' },
            take: limit,
          });

    const unreadCount = await this.unreadCount(userId);

    return {
      items,
      // При пустой выдаче курсор не двигаем — отдаём тот, что прислал клиент.
      cursor: items.at(-1)?.seq ?? after ?? 0,
      unreadCount,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /** Без ids — прочитать всё. userId в where обязателен: чужой id не должен помечаться. */
  async markRead(userId: string, ids?: string[]): Promise<{ count: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { count };
  }
}
