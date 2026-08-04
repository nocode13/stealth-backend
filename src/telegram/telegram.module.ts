import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';
import { CustomerComposer } from './handlers/customer.composer';
import { SellerComposer } from './handlers/seller.composer';
import { PhoneAuthService } from './phone-auth.service';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramLinkModule } from './telegram-link.module';
import { TelegramWebhookController } from './telegram-webhook.controller';

// Входящая часть Telegram: бот, хендлеры покупателя и кабинет продавца.
// Исходящие сообщения — в TelegramNotifyModule, привязка рабочего аккаунта — в
// TelegramLinkModule (оба вынесены, чтобы не было цикла с OrdersModule/SellersModule).
@Module({
  imports: [AuthModule, UsersModule, OrdersModule, TelegramLinkModule],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramAuthService,
    PhoneAuthService,
    TelegramBotService,
    SellerComposer,
    CustomerComposer,
  ],
  exports: [TelegramAuthService, PhoneAuthService, TelegramLinkModule],
})
export class TelegramModule {}
