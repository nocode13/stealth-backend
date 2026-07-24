import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InlineKeyboard } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../telegram/telegram-notify.service';
import type { OrderWithDetails } from './orders.service';
import {
  ALLOWED_TRANSITIONS,
  CUSTOMER_STATUS_MESSAGES,
  ORDER_ACTION_LABELS,
  ORDER_STATUS_LABELS,
} from './order-status';

// Значения приходят в тиинах (1 сум = 100 тиинов) — делим на 100 перед показом.
const money = (tiyin: number): string =>
  (tiyin / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Формирует и рассылает сообщения о заказах: продавцу — новый заказ и карточку
 * с кнопками действий, покупателю — смену статуса.
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
    private readonly config: ConfigService,
  ) {}

  private adminOrderUrl(orderId: string): string {
    return `${this.config.get<string>('adminUrl')}/orders/${orderId}`;
  }

  /**
   * Карточка заказа для продавца/курьера: состав, контакты, адрес и кнопки
   * следующих шагов. Кнопки строятся из ALLOWED_TRANSITIONS — того же источника,
   * что валидирует OrdersService.changeStatus, поэтому бот и админка не разъезжаются.
   */
  buildSellerCard(order: OrderWithDetails): {
    text: string;
    keyboard: InlineKeyboard;
  } {
    const lines = [
      `<b>Заказ #${order.orderNumber}</b> — ${ORDER_STATUS_LABELS[order.status]}`,
      '',
      ...order.items.map(
        (item) =>
          `• ${escapeHtml(item.catalogItemName)} — ${item.quantity} ${escapeHtml(
            item.unit,
          )} × ${money(item.price)} = ${money(item.total)}`,
      ),
      '',
      `<b>Итого: ${money(order.total)}</b>`,
      `Оплата: наличными курьеру`,
      '',
      `👤 ${escapeHtml(order.contactName)}`,
      `📞 ${escapeHtml(order.contactPhone)}`,
      `📍 ${escapeHtml(order.deliveryAddress)}`,
      ...(order.deliveryComment
        ? [`💬 ${escapeHtml(order.deliveryComment)}`]
        : []),
    ];

    const keyboard = new InlineKeyboard();
    for (const next of ALLOWED_TRANSITIONS[order.status]) {
      keyboard.text(ORDER_ACTION_LABELS[next], `ord:${order.id}:${next}`).row();
    }
    keyboard.url('🖥 Открыть в админке', this.adminOrderUrl(order.id));

    return { text: lines.join('\n'), keyboard };
  }

  /** Новый заказ → продавцу карточка + нативная локация с кнопкой «Маршрут». */
  async orderCreated(orders: OrderWithDetails[]): Promise<void> {
    for (const order of orders) {
      try {
        const telegramId = await this.sellerTelegramId(order.sellerId);
        if (!telegramId) {
          this.logger.warn(
            `Продавец ${order.sellerId} не привязал Telegram — заказ #${order.orderNumber} только в админке.`,
          );
          continue;
        }
        const { text, keyboard } = this.buildSellerCard(order);
        await this.telegram.sendMessage(
          telegramId,
          `🆕 <b>Новый заказ!</b>\n\n${text}`,
          keyboard,
        );
        if (order.deliveryLat != null && order.deliveryLng != null) {
          await this.telegram.sendLocation(
            telegramId,
            order.deliveryLat,
            order.deliveryLng,
          );
        }
      } catch (error) {
        this.logger.error(
          `Уведомление о заказе #${order.orderNumber} не ушло: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Статус поменял продавец → сообщаем покупателю. */
  async statusChanged(order: OrderWithDetails): Promise<void> {
    const message = CUSTOMER_STATUS_MESSAGES[order.status];
    if (!message) return;
    try {
      const telegramId = await this.customerTelegramId(order.userId);
      await this.telegram.sendMessage(
        telegramId,
        `<b>Заказ #${order.orderNumber}</b>\n${message}`,
      );
    } catch (error) {
      this.logger.error(
        `Не удалось уведомить покупателя по заказу #${order.orderNumber}: ${(error as Error).message}`,
      );
    }
  }

  /** Покупатель отменил сам → сообщаем продавцу, чтобы тот не собирал зря. */
  async cancelledByCustomer(order: OrderWithDetails): Promise<void> {
    try {
      const telegramId = await this.sellerTelegramId(order.sellerId);
      await this.telegram.sendMessage(
        telegramId,
        `❌ Покупатель отменил заказ <b>#${order.orderNumber}</b>.` +
          (order.cancelReason
            ? `\nПричина: ${escapeHtml(order.cancelReason)}`
            : ''),
      );
    } catch (error) {
      this.logger.error(
        `Не удалось уведомить продавца об отмене #${order.orderNumber}: ${(error as Error).message}`,
      );
    }
  }

  private async sellerTelegramId(sellerId: string): Promise<string | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { owner: { select: { telegramId: true } } },
    });
    return seller?.owner.telegramId ?? null;
  }

  private async customerTelegramId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    return user?.telegramId ?? null;
  }
}
