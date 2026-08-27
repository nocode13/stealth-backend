import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Только исходящая почта, без импортов — по образцу PushModule/TelegramNotifyModule.
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
