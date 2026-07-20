import { Module } from '@nestjs/common';
import { TelegramNotifyService } from './telegram-notify.service';

/**
 * Только исходящие сообщения бота, без хендлеров и без инстанса `Bot`.
 *
 * Вынесено из TelegramModule намеренно: OrdersModule зависит от уведомлений,
 * а TelegramModule (кабинет продавца в боте) — от OrdersService. Разрезав
 * исходящие в отдельный модуль без зависимостей, мы избегаем цикла и forwardRef.
 */
@Module({
  providers: [TelegramNotifyService],
  exports: [TelegramNotifyService],
})
export class TelegramNotifyModule {}
