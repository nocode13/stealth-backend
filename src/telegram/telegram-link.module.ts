import { Module } from '@nestjs/common';
import { TelegramLinkService } from './telegram-link.service';

/**
 * Привязка рабочего Telegram — отдельным модулем по той же причине, что и
 * TelegramNotifyModule: сессии привязки нужны и боту продавца, и SellersModule
 * (инвайт сотрудника), а тянуть ради этого весь TelegramModule нельзя — он
 * импортирует OrdersModule, и получился бы цикл.
 */
@Module({
  providers: [TelegramLinkService],
  exports: [TelegramLinkService],
})
export class TelegramLinkModule {}
