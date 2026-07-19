import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

// Вход в мобилку через Telegram: бот (/start <nonce>) + сессии входа + Mini App.
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramAuthService, TelegramBotService],
  exports: [TelegramAuthService],
})
export class TelegramModule {}
