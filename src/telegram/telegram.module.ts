import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';
import { CustomerComposer } from './handlers/customer.composer';
import { SellerComposer } from './handlers/seller.composer';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

// Входящая часть Telegram: бот, хендлеры покупателя и кабинет продавца.
// Исходящие сообщения — в TelegramNotifyModule (без него был бы цикл с OrdersModule).
@Module({
  imports: [AuthModule, UsersModule, OrdersModule],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramAuthService,
    TelegramLinkService,
    TelegramBotService,
    SellerComposer,
    CustomerComposer,
  ],
  exports: [TelegramAuthService, TelegramLinkService],
})
export class TelegramModule {}
