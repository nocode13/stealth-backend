import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OtpDeliveryRegistry } from './channels/otp-delivery.registry';
import { OTP_SENDERS } from './channels/otp-sender.interface';
import { EmailOtpSender } from './channels/email-otp.sender';
import { SmsOtpSender } from './channels/sms-otp.sender';
import { TelegramOtpSender } from './channels/telegram-otp.sender';

@Module({
  providers: [
    OtpService,
    OtpDeliveryRegistry,
    EmailOtpSender,
    SmsOtpSender,
    TelegramOtpSender,
    // Собираем все отправители в массив под токеном OTP_SENDERS.
    // Добавить канал = добавить sender сюда, registry подхватит по channel.
    {
      provide: OTP_SENDERS,
      useFactory: (
        email: EmailOtpSender,
        sms: SmsOtpSender,
        telegram: TelegramOtpSender,
      ) => [email, sms, telegram],
      inject: [EmailOtpSender, SmsOtpSender, TelegramOtpSender],
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
