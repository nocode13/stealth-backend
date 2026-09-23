import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Api, GrammyError } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';

export type BroadcastSendResult =
  | { status: 'ok' | 'blocked' | 'error' }
  | { status: 'retry'; retryAfter: number };

/**
 * ИСХОДЯЩИЕ сообщения ботов. Держит собственные `Api` (это просто HTTP-клиенты к
 * Bot API), а не инстансы `Bot` из TelegramBotService — намеренно.
 *
 * Так разрывается цикл модулей: OrdersService уведомляет через этот сервис, а
 * кабинет продавца в боте зовёт OrdersService. Если бы уведомления жили на том же
 * объекте `Bot`, что и хендлеры, TelegramModule и OrdersModule ссылались бы друг
 * на друга и потребовался бы forwardRef.
 *
 * Ботов два (покупательский и продавца), поэтому и методы разведены по адресату:
 * покупателю пишем по `User.telegramId` из основного бота, продавцу — по
 * `User.staffTelegramId` из бота продавца. Перепутать бот и id нельзя.
 *
 * Все методы «мягкие»: без токена или при ошибке Telegram они логируют и молчат.
 * Заказ уже создан — падение мессенджера не должно превращаться в 500 для клиента.
 */
@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);
  private readonly mainApi?: Api;
  private readonly sellerApi?: Api;

  constructor(private readonly config: ConfigService) {
    const mainToken = this.config.get<string>('telegram.botToken');
    if (mainToken) {
      this.mainApi = new Api(mainToken);
    } else {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN не задан — уведомления покупателям отключены.',
      );
    }

    const sellerToken = this.config.get<string>('telegramSeller.botToken');
    if (sellerToken) {
      this.sellerApi = new Api(sellerToken);
    } else {
      this.logger.warn(
        'TELEGRAM_SELLER_BOT_TOKEN не задан — уведомления продавцам отключены.',
      );
    }
  }

  /** Покупателю — в основной бот, по User.telegramId. */
  sendToCustomer(
    telegramId: string | null | undefined,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    return this.send(this.mainApi, telegramId, text, replyMarkup);
  }

  /** Продавцу — в бот продавца, по User.staffTelegramId. */
  sendToSeller(
    staffTelegramId: string | null | undefined,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    return this.send(this.sellerApi, staffTelegramId, text, replyMarkup);
  }

  /**
   * Сообщение рассылки покупателю. В отличие от остальных методов не глотает
   * исход молча, а возвращает его: рассылке нужны счётчики и повтор после 429
   * (Bot API ограничивает ~30 сообщений в секунду на бота).
   */
  async sendBroadcastToCustomer(
    telegramId: string,
    html: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<BroadcastSendResult> {
    if (!this.mainApi) return { status: 'error' };
    try {
      await this.mainApi.sendMessage(telegramId, html, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      });
      return { status: 'ok' };
    } catch (error) {
      if (error instanceof GrammyError) {
        if (error.error_code === 429) {
          return {
            status: 'retry',
            retryAfter: error.parameters.retry_after ?? 1,
          };
        }
        // 403 — бот заблокирован / юзер деактивирован: это не сбой, а отписка.
        if (error.error_code === 403) return { status: 'blocked' };
      }
      this.logger.error(
        `Не удалось отправить рассылку ${telegramId}: ${(error as Error).message}`,
      );
      return { status: 'error' };
    }
  }

  /**
   * Нативная карточка локации — у неё есть встроенная кнопка «Маршрут», которая
   * открывает Яндекс.Навигатор / Google Maps. Это и есть навигация для курьера:
   * карт-SDK и платных API не нужно. Продавец может переслать её курьеру,
   * пересылка сохраняет геоточку.
   */
  async sendLocationToSeller(
    staffTelegramId: string | null | undefined,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    if (!this.sellerApi || !staffTelegramId) return;
    try {
      await this.sellerApi.sendLocation(staffTelegramId, latitude, longitude);
    } catch (error) {
      this.logger.error(
        `Не удалось отправить локацию ${staffTelegramId}: ${(error as Error).message}`,
      );
    }
  }

  private async send(
    api: Api | undefined,
    chatId: string | null | undefined,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    if (!api || !chatId) return;
    try {
      await api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      this.logger.error(
        `Не удалось отправить сообщение ${chatId}: ${(error as Error).message}`,
      );
    }
  }
}
