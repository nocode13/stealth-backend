import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Role, type User } from '@prisma/client';
import { Composer, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { AuthPrincipal } from '../../common/decorators/current-user.decorator';
import { OrderNotifier } from '../../orders/order-notifier.service';
import { ORDER_STATUS_LABELS } from '../../orders/order-status';
import { OrdersService } from '../../orders/orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TELEGRAM_TAKEN_BY_STAFF } from '../../common/telegram-identity';
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
  takenByStaff: TELEGRAM_TAKEN_BY_STAFF,
};

const menuKeyboard = new InlineKeyboard()
  .text('📦 Активные заказы', 'sel:list:active')
  .row()
  .text('🚚 В доставке', 'sel:list:delivery');

/**
 * Кабинет продавца прямо в чате с ботом — без Mini App, на inline-клавиатурах.
 * Живёт в ОТДЕЛЬНОМ боте продавца и ищет юзера по `staffTelegramId`: тот же самый
 * Telegram может быть покупателем в основном боте, это независимая учётка.
 *
 * ВАЖНО ПРО БЕЗОПАСНОСТЬ: `callback_data` — это данные от клиента, их можно
 * подделать или нажать кнопку из пересланного кому-то сообщения. Поэтому роль
 * и принадлежность заказа проверяются заново на КАЖДЫЙ колбэк (resolveSeller +
 * OrdersService), а не берутся из того, что пришло в кнопке.
 *
 * Кабинет read-only: менять статус отсюда нельзя (нет ни кнопок, ни колбэка) —
 * это единственный способ не дать SELLER обойти запрет из AdminOrdersController
 * в два клика. Списки и карточка-просмотр (findOneForStaff) остаются.
 */
@Injectable()
export class SellerComposer {
  private readonly logger = new Logger(SellerComposer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifier: OrderNotifier,
    private readonly links: TelegramLinkService,
    private readonly config: ConfigService,
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

    // /start без payload — меню кабинета. Этот бот только для продавцов, поэтому
    // всех остальных отправляем в основной бот, а не молчим.
    composer.command('start', async (ctx) => {
      const seller = await this.resolveSeller(ctx);
      if (!seller) {
        await ctx.reply(this.notSellerText());
        return;
      }

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
        const { text, keyboard } = await this.notifier.buildSellerCard(order);
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
      } catch (error) {
        await ctx.reply(this.errorText(error));
      }
    });

    // Смена статуса кнопкой (ord:<orderId>:<STATUS>) убрана вместе с кнопками в
    // buildSellerCard — статус теперь меняет только SUPER_ADMIN из админки (см.
    // AGENTS.md «Заказы»). Старые кнопки в истории чата просто не находят
    // обработчик — grammy их молча игнорирует, бот не падает.

    return composer;
  }

  private async sendOrderList(
    ctx: Context,
    seller: SellerContext,
    statuses: OrderStatus[],
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      // sellerId нет только у SUPER_ADMIN без магазина — ему показываем все заказы,
      // а не пустой список (раньше фильтр по null молча ничего не находил).
      where: {
        sellerId: seller.principal.sellerId ?? undefined,
        status: { in: statuses },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        itemsTotal: true,
        group: { select: { contactName: true } },
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
            order.itemsTotal / 100
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
   * Кто нажал кнопку. Ищем по `staffTelegramId` — покупательская учётка с тем же
   * Telegram (колонка `telegramId`) кабинет не открывает. null — не продавец,
   * колбэки от него отклоняются.
   */
  private async resolveSeller(ctx: Context): Promise<SellerContext | null> {
    if (!ctx.from) return null;
    const user: User | null = await this.prisma.user.findUnique({
      where: { staffTelegramId: String(ctx.from.id) },
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

  /** Покупатель зашёл не в тот бот — подсказываем основной. */
  private notSellerText(): string {
    const mainBot = this.config.get<string>('telegram.botUsername');
    return (
      'Этот бот — рабочий кабинет продавца.' +
      (mainBot
        ? ` Если вы покупатель, вам в @${mainBot}.`
        : ' Если вы покупатель, откройте приложение.')
    );
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
