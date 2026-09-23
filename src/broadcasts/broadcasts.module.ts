import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { TelegramNotifyModule } from '../telegram/telegram-notify.module';
import { BroadcastsService } from './broadcasts.service';

// Лента пишется напрямую через Prisma (createMany), а не через NotificationsService:
// тому нужен bulk-метод только ради рассылок, а тип и payload — здесь.
@Module({
  imports: [PushModule, TelegramNotifyModule],
  providers: [BroadcastsService],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}
