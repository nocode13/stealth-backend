import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel } from '@prisma/client';
import { OtpDeliverySender } from './otp-sender.interface';

// ЗАГЛУШКА: пишет код в лог. Точка подключения реального Telegram-бота.
// destination — это telegramId (chat id пользователя в боте).
// TODO: когда появится бот — заменить тело send() на вызов Bot API:
//   POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage
//   { chat_id: destination, text: `Ваш код входа: ${code}` }
// Токен уже прокинут в config 'telegram.botToken'. Библиотека (telegraf/fetch) — на выбор.
@Injectable()
export class TelegramOtpSender implements OtpDeliverySender {
  readonly channel = OtpChannel.TELEGRAM;
  private readonly logger = new Logger(TelegramOtpSender.name);

  constructor(private readonly config: ConfigService) {}

  async send(destination: string, code: string): Promise<void> {
    await Promise.resolve(); // заглушка: реальная отправка станет настоящим await
    const botToken = this.config.get<string>('telegram.botToken');
    if (!botToken) {
      this.logger.log(`[DEV Telegram OTP] chat ${destination} → код ${code}`);
      return;
    }
    // TODO: реальная отправка через Telegram Bot API.
    this.logger.warn(
      `Telegram-бот задан, но отправка не реализована — код ${code} для chat ${destination} не отправлен.`,
    );
  }
}
