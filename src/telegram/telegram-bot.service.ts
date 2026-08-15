import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Composer } from 'grammy';
import type { Context } from 'grammy';
import type { Update } from 'grammy/types';
import { CustomerComposer } from './handlers/customer.composer';
import { SellerComposer } from './handlers/seller.composer';
import { SuperAdminOrdersComposer } from './handlers/superadmin-orders.composer';

/** Какой из двух ботов имеется в виду. */
export type BotTarget = 'main' | 'seller';

/**
 * Bootstrap ботов: токен, режим (вебхук/поллинг), подключение хендлеров.
 * Самих хендлеров тут нет — они в handlers/*.composer.ts.
 *
 * Ботов два, и они намеренно разные:
 * - **основной** — покупатели: вход в мобилку (nonce, Mini App, OTP по номеру)
 *   и уведомления покупателю;
 * - **продавца** — кабинет заказов и уведомления продавцу.
 *
 * Разделение нужно потому, что один и тот же человек может быть и покупателем, и
 * продавцом. Это две разные учётки User, и каждый бот ищет свою по своей колонке
 * (`telegramId` против `staffTelegramId`).
 *
 * Исходящие сообщения живут отдельно (TelegramNotifyService) — см. комментарий там.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bots: Partial<Record<BotTarget, Bot>> = {};

  constructor(
    private readonly config: ConfigService,
    private readonly sellerComposer: SellerComposer,
    private readonly superAdminOrdersComposer: SuperAdminOrdersComposer,
    private readonly customerComposer: CustomerComposer,
  ) {}

  async onModuleInit(): Promise<void> {
    const webhookUrl = this.config.get<string>('telegram.webhookUrl');

    this.bots.main = await this.startBot({
      target: 'main',
      token: this.config.get<string>('telegram.botToken'),
      composer: this.customerComposer.build(),
      webhookUrl,
      missingTokenWarning:
        'TELEGRAM_BOT_TOKEN не задан — основной бот не запущен, вход в мобилку работать не будет.',
    });

    this.bots.seller = await this.startBot({
      target: 'seller',
      token: this.config.get<string>('telegramSeller.botToken'),
      // Кабинет продавца (read-only) и кнопки статуса группы для SUPER_ADMIN —
      // два независимых композера на одном боте, ни один не знает о другом
      // (см. комментарий в superadmin-orders.composer.ts).
      composer: [
        this.sellerComposer.build(),
        this.superAdminOrdersComposer.build(),
      ],
      // Вебхук продавца — производный от основного, чтобы на проде не заводить
      // ещё одну переменную с почти тем же значением.
      webhookUrl: webhookUrl ? `${webhookUrl}/seller` : undefined,
      missingTokenWarning:
        'TELEGRAM_SELLER_BOT_TOKEN не задан — бот продавца не запущен, кабинет и уведомления продавцу не работают.',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(Object.values(this.bots).map((bot) => bot.stop()));
  }

  // Точка входа для вебхук-контроллера.
  async handleUpdate(target: BotTarget, update: Update): Promise<void> {
    await this.bots[target]?.handleUpdate(update);
  }

  get isWebhookMode(): boolean {
    return !!this.config.get<boolean>('telegram.useWebhook');
  }

  webhookSecret(target: BotTarget): string | undefined {
    const key =
      target === 'main'
        ? 'telegram.webhookSecret'
        : 'telegramSeller.webhookSecret';
    return this.config.get<string>(key) || undefined;
  }

  private async startBot(opts: {
    target: BotTarget;
    token?: string;
    composer: Composer<Context> | Composer<Context>[];
    webhookUrl?: string;
    missingTokenWarning: string;
  }): Promise<Bot | undefined> {
    if (!opts.token) {
      // Без токена приложение поднимается: соответствующая часть просто недоступна.
      this.logger.warn(opts.missingTokenWarning);
      return undefined;
    }

    const bot = new Bot(opts.token);
    const composers = Array.isArray(opts.composer)
      ? opts.composer
      : [opts.composer];
    for (const composer of composers) {
      bot.use(composer);
    }
    bot.catch((err) => {
      this.logger.error(
        `Ошибка в обработчике бота (${opts.target}): ${err.message}`,
        err.error,
      );
    });

    if (this.isWebhookMode) {
      if (!opts.webhookUrl) {
        this.logger.error(
          `TELEGRAM_USE_WEBHOOK=true, но TELEGRAM_WEBHOOK_URL пуст — бот (${opts.target}) не запущен.`,
        );
        return undefined;
      }
      await bot.init();
      await bot.api.setWebhook(opts.webhookUrl, {
        secret_token: this.webhookSecret(opts.target),
      });
      this.logger.log(
        `Бот (${opts.target}) слушает вебхук: ${opts.webhookUrl}`,
      );
    } else {
      // Long-polling: удобно в dev, публичный URL не нужен.
      // start() резолвится только при остановке бота — намеренно не await'им.
      await bot.api.deleteWebhook();
      void bot.start({
        onStart: (me) =>
          this.logger.log(
            `Бот @${me.username} (${opts.target}) запущен (polling)`,
          ),
      });
    }

    return bot;
  }
}
