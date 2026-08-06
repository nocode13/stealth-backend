import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { PushTokensService } from './push-tokens.service';

/**
 * Только исходящие пуши и реестр токенов — по образцу TelegramNotifyModule.
 *
 * Без импортов намеренно: OrdersModule зависит от отправки уведомлений, и любая
 * доменная зависимость отсюда вернула бы цикл, который тот модуль как раз и
 * обходит.
 */
@Module({
  providers: [PushService, PushTokensService],
  exports: [PushService, PushTokensService],
})
export class PushModule {}
