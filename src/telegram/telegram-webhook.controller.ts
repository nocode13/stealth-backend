import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Update } from 'grammy/types';
import { TelegramBotService } from './telegram-bot.service';

// Приёмник апдейтов Telegram. Публичный (гварда нет, как у витринных контроллеров) —
// вместо авторизации сверяем секрет, который сами передали в setWebhook.
// Используется только при TELEGRAM_USE_WEBHOOK=true; в dev работает polling.
@ApiExcludeController()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly bot: TelegramBotService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<void> {
    const expected = this.bot.webhookSecret;
    if (expected && secret !== expected) {
      throw new ForbiddenException();
    }
    await this.bot.handleUpdate(update);
  }
}
