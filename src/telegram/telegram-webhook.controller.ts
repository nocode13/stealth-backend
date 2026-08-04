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
import type { BotTarget } from './telegram-bot.service';
import { TelegramBotService } from './telegram-bot.service';

// Приёмник апдейтов Telegram. Публичный (гварда нет, как у витринных контроллеров) —
// вместо авторизации сверяем секрет, который сами передали в setWebhook.
// Ботов два, поэтому и роута два: у каждого свой секрет и свои хендлеры.
// Используется только при TELEGRAM_USE_WEBHOOK=true; в dev работает polling.
@ApiExcludeController()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly bot: TelegramBotService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<void> {
    return this.dispatch('main', update, secret);
  }

  @Post('webhook/seller')
  @HttpCode(HttpStatus.OK)
  sellerWebhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<void> {
    return this.dispatch('seller', update, secret);
  }

  private async dispatch(
    target: BotTarget,
    update: Update,
    secret?: string,
  ): Promise<void> {
    const expected = this.bot.webhookSecret(target);
    if (expected && secret !== expected) {
      throw new ForbiddenException();
    }
    await this.bot.handleUpdate(target, update);
  }
}
