import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel } from '@prisma/client';
import { OtpDeliverySender } from './otp-sender.interface';

// ЗАГЛУШКА: пишет код в лог. Точка подключения реального SMS-провайдера.
// TODO: заменить тело send() на вызов провайдера (Eskiz.uz / Play Mobile / Twilio),
// креды — config 'sms.provider' / 'sms.apiKey'.
@Injectable()
export class SmsOtpSender implements OtpDeliverySender {
  readonly channel = OtpChannel.SMS;
  private readonly logger = new Logger(SmsOtpSender.name);

  constructor(private readonly config: ConfigService) {}

  async send(destination: string, code: string): Promise<void> {
    await Promise.resolve(); // заглушка: реальная отправка станет настоящим await
    const provider = this.config.get<string>('sms.provider');
    if (!provider) {
      this.logger.log(`[DEV SMS OTP] ${destination} → код ${code}`);
      return;
    }
    // TODO: реальная отправка через SMS-провайдера.
    this.logger.warn(
      `SMS-провайдер '${provider}' пока не реализован — код ${code} для ${destination} не отправлен реально.`,
    );
  }
}
