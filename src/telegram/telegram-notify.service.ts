import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Api } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';

/**
 * ИСХОДЯЩИЕ сообщения бота. Держит собственный `Api` (это просто HTTP-клиент к
 * Bot API), а не инстанс `Bot` из TelegramBotService — намеренно.
 *
 * Так разрывается цикл модулей: OrdersService уведомляет через этот сервис, а
 * кабинет продавца в боте зовёт OrdersService. Если бы уведомления жили на том же
 * объекте `Bot`, что и хендлеры, TelegramModule и OrdersModule ссылались бы друг
 * на друга и потребовался бы forwardRef.
 *
 * Все методы «мягкие»: без токена или при ошибке Telegram они логируют и молчат.
 * Заказ уже создан — падение мессенджера не должно превращаться в 500 для клиента.
 */
@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);
  private readonly api?: Api;

  constructor(private readonly config: ConfigService) {
    const token = this.config.get<string>('telegram.botToken');
    if (token) {
      this.api = new Api(token);
    } else {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN не задан — уведомления в Telegram отключены.',
      );
    }
  }

  async sendMessage(
    telegramId: string | null | undefined,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    if (!this.api || !telegramId) return;
    try {
      await this.api.sendMessage(telegramId, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      this.logger.error(
        `Не удалось отправить сообщение ${telegramId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Нативная карточка локации — у неё есть встроенная кнопка «Маршрут», которая
   * открывает Яндекс.Навигатор / Google Maps. Это и есть навигация для курьера:
   * карт-SDK и платных API не нужно. Продавец может переслать её курьеру,
   * пересылка сохраняет геоточку.
   */
  async sendLocation(
    telegramId: string | null | undefined,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    if (!this.api || !telegramId) return;
    try {
      await this.api.sendLocation(telegramId, latitude, longitude);
    } catch (error) {
      this.logger.error(
        `Не удалось отправить локацию ${telegramId}: ${(error as Error).message}`,
      );
    }
  }
}
