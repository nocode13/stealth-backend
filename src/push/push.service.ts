import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { PushTokensService } from './push-tokens.service';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Отправка пушей через Expo Push Service.
 *
 * Канал «мягкий»: любая ошибка логируется и глотается — как fanOut() в
 * OrderNotifier. Смена статуса заказа не должна падать из-за недоступного Expo.
 *
 * Битые токены вычищаем в два прохода, как требует Expo: сначала тикеты (там
 * ловятся невалидные токены сразу), потом receipts (там приезжает
 * DeviceNotRegistered — приложение снесли или переустановили).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    config: ConfigService,
    private readonly tokens: PushTokensService,
  ) {
    const accessToken = config.get<string>('push.expoAccessToken');
    this.expo = new Expo({ accessToken: accessToken || undefined });
  }

  /**
   * @returns true, если пуш реально ушёл хотя бы на одну установку. По этому
   * флагу вызывающий решает, слать ли запасной канал (Telegram-DM): «нет живых
   * токенов» и «Expo недоступен» одинаково означают, что юзер ничего не получил.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<boolean> {
    const rows = await this.tokens.listFor(userId);
    if (rows.length === 0) return false;

    // Expo.isExpoPushToken отсекает мусор до сети: чужой формат вернул бы ошибку
    // на весь чанк.
    const valid = rows.filter((r) => Expo.isExpoPushToken(r.token));
    for (const row of rows) {
      if (!valid.includes(row)) {
        this.logger.warn(`Невалидный push-токен, удаляю: ${row.token}`);
        await this.tokens.unregister(row.token);
      }
    }
    if (valid.length === 0) return false;

    const messages: ExpoPushMessage[] = valid.map((row) => ({
      to: row.token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: 'default',
      // Канал должен существовать на клиенте (setNotificationChannelAsync),
      // иначе на Android 8+ уведомление придёт беззвучным.
      channelId: 'orders',
    }));

    try {
      const tickets = await this.sendChunks(messages);
      await this.dropDeadTokens(
        tickets,
        valid.map((r) => r.token),
      );
      void this.checkReceipts(tickets);
      return tickets.some((t) => t.status === 'ok');
    } catch (e) {
      this.logger.error(`Не удалось отправить push: ${String(e)}`);
      return false;
    }
  }

  private async sendChunks(
    messages: ExpoPushMessage[],
  ): Promise<ExpoPushTicket[]> {
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)));
    }
    return tickets;
  }

  // Тикеты приходят в том же порядке, что и сообщения, — по индексу знаем токен.
  private async dropDeadTokens(
    tickets: ExpoPushTicket[],
    tokens: string[],
  ): Promise<void> {
    for (const [i, ticket] of tickets.entries()) {
      if (ticket.status !== 'error') continue;
      this.logger.warn(`Push отклонён: ${ticket.message}`);
      if (ticket.details?.error === 'DeviceNotRegistered') {
        await this.tokens.unregister(tokens[i]);
      }
    }
  }

  /**
   * Второй проход: Expo принимает сообщение сразу, но реальный вердикт APNs/FCM
   * приезжает позже. Без него мёртвые установки копились бы в push_tokens.
   *
   * Ждём 15 секунд и проверяем один раз — не cron: своего планировщика в проекте
   * нет, а объём уведомлений (несколько на заказ) такой отложенной проверки
   * вполне достаточен. Результат никого не блокирует, вызывается через `void`.
   */
  private async checkReceipts(tickets: ExpoPushTicket[]): Promise<void> {
    const ids = tickets
      .filter((t) => t.status === 'ok')
      .map((t) => t.id)
      .filter(Boolean);
    if (ids.length === 0) return;

    await new Promise((resolve) => setTimeout(resolve, 15_000));

    try {
      for (const chunk of this.expo.chunkPushNotificationReceiptIds(ids)) {
        const receipts =
          await this.expo.getPushNotificationReceiptsAsync(chunk);
        for (const receipt of Object.values(receipts)) {
          if (receipt.status !== 'error') continue;
          this.logger.warn(`Push не доставлен: ${receipt.message}`);
          // Токен в receipt не приходит — Expo кладёт его в details.
          const dead = receipt.details as
            { error?: string; expoPushToken?: string } | undefined;
          if (dead?.error === 'DeviceNotRegistered' && dead.expoPushToken) {
            await this.tokens.unregister(dead.expoPushToken);
          }
        }
      }
    } catch (e) {
      this.logger.error(`Не удалось получить receipts: ${String(e)}`);
    }
  }
}
