import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type OrderGroup, type OrderStatus } from '@prisma/client';
import { InlineKeyboard } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../telegram/telegram-notify.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import type { OrderGroupWithOrders, OrderWithDetails } from './orders.service';
import {
  ALLOWED_TRANSITIONS,
  CUSTOMER_GROUP_STATUS_MESSAGES,
  ORDER_ACTION_LABELS,
  ORDER_STATUS_LABELS,
  isTerminal,
} from './order-status';

// Значения приходят в тиинах (1 сум = 100 тиинов) — делим на 100 перед показом.
const money = (tiyin: number): string =>
  (tiyin / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Формирует и рассылает сообщения о заказах: продавцу — новый заказ и карточку
 * с кнопками действий, покупателю — смену статуса его ГРУППЫ.
 *
 * Всё «мягкое»: любая ошибка логируется и глотается. Заказ уже в базе, и
 * недоступный Telegram не должен превращаться в ошибку оформления.
 */
@Injectable()
export class OrderNotifier {
  private readonly logger = new Logger(OrderNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifyService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  private adminOrderUrl(orderId: string): string {
    return `${this.config.get<string>('adminUrl')}/orders/${orderId}`;
  }

  /**
   * Карточка заказа для продавца/курьера: состав, контакты, адрес и ссылка на
   * админку. Кнопок статусов у карточки больше нет — статус меняет только
   * SUPER_ADMIN из админки (см. AGENTS.md «Заказы»), кабинет продавца в боте
   * read-only.
   */
  async buildSellerCard(order: OrderWithDetails): Promise<{
    text: string;
    keyboard: InlineKeyboard;
  }> {
    // Заказ из мультипродавцового чекаута — продавец должен понимать, что
    // покупатель ждёт ещё коробку от соседа по группе.
    const siblings = await this.prisma.order.findMany({
      where: { groupId: order.groupId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const partIndex = siblings.findIndex((s) => s.id === order.id) + 1;

    const lines = [
      `<b>Заказ #${order.orderNumber}</b> — ${ORDER_STATUS_LABELS[order.status]}`,
      ...(siblings.length > 1
        ? [
            `Заказ №${order.group.groupNumber}, часть ${partIndex} из ${siblings.length}`,
          ]
        : []),
      '',
      ...order.items.map(
        (item) =>
          `• ${escapeHtml(item.catalogItemName)} — ${item.quantity} ${escapeHtml(
            item.unit,
          )} × ${money(item.price)} = ${money(item.total)}`,
      ),
      '',
      `<b>Итого: ${money(order.itemsTotal)}</b>`,
      `Оплата: наличными курьеру`,
      '',
      `👤 ${escapeHtml(order.group.contactName)}`,
      `📞 ${escapeHtml(order.group.contactPhone)}`,
      `📍 ${escapeHtml(order.group.deliveryAddress)}`,
      ...(order.group.deliveryComment
        ? [`💬 ${escapeHtml(order.group.deliveryComment)}`]
        : []),
    ];

    const keyboard = new InlineKeyboard().url(
      '🖥 Открыть в админке',
      this.adminOrderUrl(order.id),
    );

    return { text: lines.join('\n'), keyboard };
  }

  /** Новый заказ → всей команде продавца карточка + нативная локация с «Маршрутом». */
  async orderCreated(orders: OrderWithDetails[]): Promise<void> {
    for (const order of orders) {
      try {
        const recipients = await this.sellerTelegramIds(order.sellerId);
        if (recipients.length === 0) {
          this.logger.warn(
            `Никто из команды продавца ${order.sellerId} не привязал Telegram — заказ #${order.orderNumber} только в админке.`,
          );
          continue;
        }
        const { text, keyboard } = await this.buildSellerCard(order);
        await this.fanOut(recipients, async (staffTelegramId) => {
          await this.telegram.sendToSeller(
            staffTelegramId,
            `🆕 <b>Новый заказ!</b>\n\n${text}`,
            keyboard,
          );
          if (
            order.group.deliveryLat != null &&
            order.group.deliveryLng != null
          ) {
            await this.telegram.sendLocationToSeller(
              staffTelegramId,
              order.group.deliveryLat,
              order.group.deliveryLng,
            );
          }
        });
      } catch (error) {
        this.logger.error(
          `Уведомление о заказе #${order.orderNumber} не ушло: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Карточка ГРУППЫ целиком для SUPER_ADMIN: по блоку на каждый Order (продавец,
   * состав, статус), общие контакты/адрес/итог. Кнопки статуса — пересечение
   * ALLOWED_TRANSITIONS по всем нетерминальным заказам группы (сразу после
   * создания это просто переходы из NEW), callback_data вида `grp:<id>:<status>`
   * — читает и валидирует его superadmin-orders.composer.ts, здесь только текст.
   */
  buildSuperAdminGroupCard(group: OrderGroupWithOrders): {
    text: string;
    keyboard: InlineKeyboard;
  } {
    const lines = [
      `<b>Группа №${group.groupNumber}</b>`,
      '',
      ...group.orders.flatMap((order) => [
        `<b>${escapeHtml(order.seller.name)}</b> — ${ORDER_STATUS_LABELS[order.status]}`,
        ...order.items.map(
          (item) =>
            `• ${escapeHtml(item.catalogItemName)} — ${item.quantity} ${escapeHtml(
              item.unit,
            )} × ${money(item.price)} = ${money(item.total)}`,
        ),
        `Сумма: ${money(order.itemsTotal)}`,
        '',
      ]),
      `<b>Итого по группе: ${money(group.total)}</b>`,
      `Оплата: наличными курьеру`,
      '',
      `👤 ${escapeHtml(group.contactName)}`,
      `📞 ${escapeHtml(group.contactPhone)}`,
      `📍 ${escapeHtml(group.deliveryAddress)}`,
      ...(group.deliveryComment
        ? [`💬 ${escapeHtml(group.deliveryComment)}`]
        : []),
    ];

    const keyboard = new InlineKeyboard();
    const nonTerminal = group.orders.filter((o) => !isTerminal(o.status));
    if (nonTerminal.length > 0) {
      const candidates = nonTerminal.reduce<OrderStatus[]>(
        (acc, order) =>
          acc.filter((s) => ALLOWED_TRANSITIONS[order.status].includes(s)),
        ALLOWED_TRANSITIONS[nonTerminal[0].status],
      );
      for (const status of candidates) {
        keyboard
          .text(ORDER_ACTION_LABELS[status], `grp:${group.id}:${status}`)
          .row();
      }
    }
    keyboard.url('🖥 Открыть в админке', this.adminOrderUrl(group.id));

    return { text: lines.join('\n'), keyboard };
  }

  /**
   * Новая ГРУППА → сводная карточка на весь чекаут всем SUPER_ADMIN с привязанным
   * Telegram (в отличие от orderCreated — там по карточке на Order команде
   * конкретного продавца). Чисто аддитивно, командам продавцов ничего не меняет.
   */
  async groupCreatedForSuperAdmins(group: OrderGroupWithOrders): Promise<void> {
    try {
      const recipients = await this.superAdminTelegramIds();
      if (recipients.length === 0) return;

      const { text, keyboard } = this.buildSuperAdminGroupCard(group);
      await this.fanOut(recipients, async (staffTelegramId) => {
        await this.telegram.sendToSeller(
          staffTelegramId,
          `🆕 <b>Новый заказ!</b>\n\n${text}`,
          keyboard,
        );
        if (group.deliveryLat != null && group.deliveryLng != null) {
          await this.telegram.sendLocationToSeller(
            staffTelegramId,
            group.deliveryLat,
            group.deliveryLng,
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Сводное уведомление о группе №${group.groupNumber} не ушло: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Статус ГРУППЫ изменился → сообщаем покупателю. Единица уведомления — группа,
   * а не Order: для покупателя заказ это весь чекаут (плоских /mobile/orders
   * нет), и каскад по трём продавцам обязан дать одно уведомление, а не три с
   * разными номерами. Звать метод должен только тот, кто убедился, что
   * выведенный статус группы РЕАЛЬНО изменился — здесь этой проверки нет.
   *
   * 1. Лента в БД — её читает мобилка поллингом. Обязательный канал: мобилка
   *    работает как Telegram Mini App, и сообщение бота приходит в чат ПОД ней,
   *    поэтому юзер, не сворачивая приложение, его не увидит.
   * 2. Push — если у юзера есть хоть одна установка нативного приложения.
   * 3. Telegram-сообщение — ИНАЧЕ, для тех, у кого нативки нет (Mini App, веб).
   *
   * Пункты 2 и 3 взаимоисключающие намеренно: с пушем Telegram-DM был бы вторым
   * уведомлением об одном событии. Мёртвые токены вычищает PushService по
   * receipts, так что «есть токен» означает живую установку, а не след от
   * удалённого приложения.
   *
   * Запись в ленту идёт ПЕРВОЙ и её ошибка не глотается: в отличие от чужих
   * Expo/Telegram, локальный insert в Postgres обязан быть надёжным. Внешние
   * каналы «мягкие» — падение сервиса не должно ронять смену статуса.
   *
   * `feedOnly` — для самоотмены покупателем: строку в ленту пишем ради полноты
   * истории, но push и DM были бы уведомлением человека о его же нажатии.
   */
  async groupStatusChanged(
    // Только поля самой группы: метод не зависит от того, отфильтрован ли
    // include по продавцу (findOneGroupForStaff умеет и так).
    group: Pick<OrderGroup, 'id' | 'userId' | 'groupNumber' | 'status'>,
    { feedOnly = false }: { feedOnly?: boolean } = {},
  ): Promise<void> {
    const message = CUSTOMER_GROUP_STATUS_MESSAGES[group.status];
    if (!message) return;

    await this.notifications.orderGroupStatusChanged(group.userId, {
      groupId: group.id,
      groupNumber: group.groupNumber,
      status: group.status,
    });

    if (feedOnly) return;

    try {
      const pushed = await this.push.sendToUser(group.userId, {
        title: `Заказ №${group.groupNumber}`,
        body: message,
        // Тот же payload, что в ленте, — по нему тап открывает нужный экран.
        data: {
          groupId: group.id,
          groupNumber: group.groupNumber,
          status: group.status,
        },
      });
      if (pushed) return;

      const telegramId = await this.customerTelegramId(group.userId);
      await this.telegram.sendToCustomer(
        telegramId,
        `<b>Заказ №${group.groupNumber}</b>\n${message}`,
      );
    } catch (error) {
      this.logger.error(
        `Не удалось уведомить покупателя по заказу №${group.groupNumber}: ${(error as Error).message}`,
      );
    }
  }

  /** Покупатель отменил сам → сообщаем команде, чтобы никто не собирал зря. */
  async cancelledByCustomer(order: OrderWithDetails): Promise<void> {
    try {
      const recipients = await this.sellerTelegramIds(order.sellerId);
      const text =
        `❌ Покупатель отменил заказ <b>#${order.orderNumber}</b>.` +
        (order.cancelReason
          ? `\nПричина: ${escapeHtml(order.cancelReason)}`
          : '');
      await this.fanOut(recipients, (staffTelegramId) =>
        this.telegram.sendToSeller(staffTelegramId, text),
      );
    } catch (error) {
      this.logger.error(
        `Не удалось уведомить продавца об отмене #${order.orderNumber}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Адреса всей команды продавца: и владелец, и сотрудники (`User.sellerId`).
   * Адрес рабочий, поэтому staffTelegramId, а не telegramId — уведомления живут
   * в боте ПРОДАВЦА. Непривязанные (staffTelegramId = null) отсеиваются здесь.
   */
  private async sellerTelegramIds(sellerId: string): Promise<string[]> {
    const staff = await this.prisma.user.findMany({
      where: {
        staffTelegramId: { not: null },
        // Владелец подстрахован отдельной веткой: у него sellerId в теории может
        // быть пустым (SetNull), а уведомление ему нужно в любом случае.
        OR: [{ sellerId }, { ownedSeller: { is: { id: sellerId } } }],
      },
      select: { staffTelegramId: true },
    });
    return staff.map((s) => s.staffTelegramId as string);
  }

  /**
   * Адреса SUPER_ADMIN с привязанным Telegram — платформенных, а не команды
   * конкретного продавца, поэтому без sellerId-фильтра, в отличие от
   * sellerTelegramIds выше. SUPER_ADMIN ходит в тот же бот продавца
   * (staffTelegramId), отдельного бота для него нет.
   */
  private async superAdminTelegramIds(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.SUPER_ADMIN, staffTelegramId: { not: null } },
      select: { staffTelegramId: true },
    });
    return admins.map((a) => a.staffTelegramId as string);
  }

  /**
   * Рассылка по команде: недоступный Telegram одного сотрудника не должен лишать
   * уведомления остальных, поэтому try/catch на КАЖДОГО адресата, а не на заказ.
   */
  private async fanOut(
    recipients: string[],
    send: (staffTelegramId: string) => Promise<void>,
  ): Promise<void> {
    for (const staffTelegramId of recipients) {
      try {
        await send(staffTelegramId);
      } catch (error) {
        this.logger.error(
          `Не доставлено staffTelegramId=${staffTelegramId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async customerTelegramId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    return user?.telegramId ?? null;
  }
}
