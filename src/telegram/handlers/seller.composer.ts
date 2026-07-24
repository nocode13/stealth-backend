import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Role, type User } from '@prisma/client';
import { Composer, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { AuthPrincipal } from '../../common/decorators/current-user.decorator';
import { OrderNotifier } from '../../orders/order-notifier.service';
import { ORDER_STATUS_LABELS } from '../../orders/order-status';
import { OrdersService } from '../../orders/orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CUSTOMER_CANNOT_BE_STAFF,
  TELEGRAM_TAKEN_BY_STAFF,
} from '../../common/telegram-identity';
import {
  TelegramLinkService,
  type LinkSellerResult,
} from '../telegram-link.service';

const PAGE_SIZE = 5;

// Статусы, которые продавец считает «в работе» — их показывает вкладка «В доставке».
const IN_DELIVERY: OrderStatus[] = [
  OrderStatus.DELIVERING,
  OrderStatus.ARRIVED,
];
const ACTIVE: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.ASSEMBLING,
];

const REPLY_BY_LINK_RESULT: Record<Exclude<LinkSellerResult, 'ok'>, string> = {
  expired: 'Ссылка привязки устарела. Сгенерируйте новую в админке.',
  takenByCustomer: CUSTOMER_CANNOT_BE_STAFF,
  takenByStaff: TELEGRAM_TAKEN_BY_STAFF,
};

const menuKeyboard = new InlineKeyboard()
  .text('📦 Активные заказы', 'sel:list:active')
  .row()
  .text('🚚 В доставке', 'sel:list:delivery');

/**
 * Кабинет продавца прямо в чате с ботом — без Mini App, на inline-клавиатурах.
 *
 * ВАЖНО ПРО БЕЗОПАСНОСТЬ: `callback_data` — это данные от клиента, их можно
 * подделать или нажать кнопку из пересланного кому-то сообщения. Поэтому роль
 * и принадлежность заказа проверяются заново на КАЖДЫЙ колбэк (resolveSeller +
 * OrdersService), а не берутся из того, что пришло в кнопке.
 *
 * Смена статуса идёт строго через OrdersService.changeStatus: там валидация
 * переходов, история и возврат остатка. Прямых prisma.update тут нет.
 */
@Injectable()
export class SellerComposer {
  private readonly logger = new Logger(SellerComposer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifier: OrderNotifier,
    private readonly links: TelegramLinkService,
  ) {}

  build(): Composer<Context> {
    const composer = new Composer();

    // Привязка аккаунта админки к Telegram: /start sel_<nonce>.
    composer.command('start', async (ctx, next) => {
      const payload = ctx.match?.trim();
      if (!ctx.from || !payload?.startsWith('sel_')) return next();

      const result = await this.links.linkSeller(
        payload.slice('sel_'.length),
        String(ctx.from.id),
      );
      if (result !== 'ok') {
        await ctx.reply(REPLY_BY_LINK_RESULT[result]);
        return;
      }
      await ctx.reply(
        '✅ Telegram привязан. Теперь заказы будут приходить сюда.',
        {
          reply_markup: menuKeyboard,
        },
      );
    });

    // /start без payload от продавца — меню кабинета. Всем остальным (покупателям)
    // отдаём управление дальше, в customer.composer, где прежний текст.
    composer.command('start', async (ctx, next) => {
      if (ctx.match?.trim()) return next();
      const seller = await this.resolveSeller(ctx);
      if (!seller) return next();

      await ctx.reply(
        `Кабинет продавца${seller.sellerName ? ` — ${seller.sellerName}` : ''}.\nВыберите раздел:`,
        { reply_markup: menuKeyboard },
      );
    });

    composer.callbackQuery(/^sel:list:(active|delivery)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const seller = await this.resolveSeller(ctx);
      if (!seller) return this.denyCallback(ctx);

      const kind = ctx.match[1];
      await this.sendOrderList(
        ctx,
        seller,
        kind === 'active' ? ACTIVE : IN_DELIVERY,
      );
    });

    // Открыть карточку конкретного заказа.
    composer.callbackQuery(/^sel:show:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const seller = await this.resolveSeller(ctx);
      if (!seller) return this.denyCallback(ctx);

      try {
        const order = await this.orders.findOneForStaff(
          seller.principal,
          ctx.match[1],
        );
        const { text, keyboard } = this.notifier.buildSellerCard(order);
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
      } catch (error) {
        await ctx.reply(this.errorText(error));
      }
    });

    // Смена статуса. Формат: ord:<orderId>:<STATUS> — тот же, что в кнопках
    // уведомления о новом заказе, поэтому карточку можно нажимать откуда угодно.
    composer.callbackQuery(/^ord:([^:]+):(.+)$/, async (ctx) => {
      const seller = await this.resolveSeller(ctx);
      if (!seller) {
        await ctx.answerCallbackQuery({
          text: 'Недостаточно прав',
          show_alert: true,
        });
        return;
      }

      const [, orderId, status] = ctx.match;
      if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
        await ctx.answerCallbackQuery({
          text: 'Неизвестный статус',
          show_alert: true,
        });
        return;
      }

      try {
        const updated = await this.orders.changeStatus(
          seller.principal,
          orderId,
          {
            status: status as OrderStatus,
          },
        );
        await ctx.answerCallbackQuery({
          text: `Статус: ${ORDER_STATUS_LABELS[updated.status]}`,
        });
        // Перерисовываем карточку на месте — кнопки следующего шага меняются.
        const { text, keyboard } = this.notifier.buildSellerCard(updated);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch (error) {
        await ctx.answerCallbackQuery({
          text: this.errorText(error),
          show_alert: true,
        });
      }
    });

    return composer;
  }

  private async sendOrderList(
    ctx: Context,
    seller: SellerContext,
    statuses: OrderStatus[],
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { sellerId: seller.principal.sellerId!, status: { in: statuses } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        contactName: true,
      },
    });

    if (orders.length === 0) {
      await ctx.reply('Заказов в этом разделе нет.', {
        reply_markup: menuKeyboard,
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const order of orders) {
      keyboard
        .text(
          `#${order.orderNumber} · ${ORDER_STATUS_LABELS[order.status]} · ${(
            order.total / 100
          ).toLocaleString('ru-RU')}`,
          `sel:show:${order.id}`,
        )
        .row();
    }

    await ctx.reply(`Найдено заказов: ${orders.length}`, {
      reply_markup: keyboard,
    });
  }

  /**
   * Кто нажал кнопку. Возвращает null для всех, кто не продавец, — тогда
   * покупательская ветка отрабатывает как обычно, а колбэки просто отклоняются.
   */
  private async resolveSeller(ctx: Context): Promise<SellerContext | null> {
    if (!ctx.from) return null;
    const user: User | null = await this.prisma.user.findUnique({
      where: { telegramId: String(ctx.from.id) },
    });
    if (!user) return null;
    if (user.role !== Role.SELLER && user.role !== Role.SUPER_ADMIN)
      return null;
    if (user.role === Role.SELLER && !user.sellerId) return null;

    const seller = user.sellerId
      ? await this.prisma.seller.findUnique({
          where: { id: user.sellerId },
          select: { name: true },
        })
      : null;

    return {
      principal: { id: user.id, role: user.role, sellerId: user.sellerId },
      sellerName: seller?.name ?? null,
    };
  }

  private async denyCallback(ctx: Context): Promise<void> {
    await ctx.reply('Этот раздел доступен только продавцам.');
  }

  private errorText(error: unknown): string {
    const response = (error as { response?: { message?: string | string[] } })
      ?.response;
    const message = response?.message;
    if (Array.isArray(message)) return message.join('\n');
    if (typeof message === 'string') return message;
    this.logger.error(`Ошибка в кабинете продавца: ${String(error)}`);
    return 'Что-то пошло не так, попробуйте ещё раз.';
  }
}

interface SellerContext {
  principal: AuthPrincipal;
  sellerName: string | null;
}
