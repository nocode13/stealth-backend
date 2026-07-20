import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { CustomerComposer } from './handlers/customer.composer';
import { SellerComposer } from './handlers/seller.composer';

/**
 * Bootstrap бота: токен, режим (вебхук/поллинг), подключение хендлеров.
 * Самих хендлеров тут нет — они в handlers/*.composer.ts.
 *
 * Порядок подключения важен: сначала продавец, потом покупатель. Обе ветки ловят
 * `/start`, и seller-композер пропускает управление дальше (next()), если юзер
 * не продавец. Так покупательский флоу остаётся ровно таким, каким был.
 *
 * Исходящие сообщения живут отдельно (TelegramNotifyService) — см. комментарий там.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot?: Bot;

  constructor(
    private readonly config: ConfigService,
    private readonly sellerComposer: SellerComposer,
    private readonly customerComposer: CustomerComposer,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>('telegram.botToken');
    if (!token) {
      // Без токена приложение поднимается: вход через Telegram просто недоступен.
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN не задан — бот не запущен, вход в мобилку работать не будет.',
      );
      return;
    }

    this.bot = new Bot(token);
    this.bot.use(this.sellerComposer.build());
    this.bot.use(this.customerComposer.build());

    this.bot.catch((err) => {
      this.logger.error(`Ошибка в обработчике бота: ${err.message}`, err.error);
    });

    if (this.config.get<boolean>('telegram.useWebhook')) {
      const url = this.config.get<string>('telegram.webhookUrl');
      if (!url) {
        this.logger.error(
          'TELEGRAM_USE_WEBHOOK=true, но TELEGRAM_WEBHOOK_URL пуст — бот не запущен.',
        );
        this.bot = undefined;
        return;
      }
      await this.bot.init();
      await this.bot.api.setWebhook(url, {
        secret_token:
          this.config.get<string>('telegram.webhookSecret') || undefined,
      });
      this.logger.log(`Бот слушает вебхук: ${url}`);
    } else {
      // Long-polling: удобно в dev, публичный URL не нужен.
      // start() резолвится только при остановке бота — намеренно не await'им.
      await this.bot.api.deleteWebhook();
      void this.bot.start({
        onStart: (me) =>
          this.logger.log(`Бот @${me.username} запущен (polling)`),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot?.stop();
  }

  // Точка входа для вебхук-контроллера.
  async handleUpdate(update: Update): Promise<void> {
    if (!this.bot) return;
    await this.bot.handleUpdate(update);
  }

  get isWebhookMode(): boolean {
    return !!this.bot && !!this.config.get<boolean>('telegram.useWebhook');
  }

  get webhookSecret(): string | undefined {
    return this.config.get<string>('telegram.webhookSecret') || undefined;
  }
}
