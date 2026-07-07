import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';
import { OTP_SENDERS, OtpDeliverySender } from './otp-sender.interface';

// Собирает все зарегистрированные senders в Map<channel, sender>
// и отдаёт нужный по каналу. Так добавление канала не трогает OtpService.
@Injectable()
export class OtpDeliveryRegistry {
  private readonly byChannel = new Map<OtpChannel, OtpDeliverySender>();

  constructor(@Inject(OTP_SENDERS) senders: OtpDeliverySender[]) {
    for (const sender of senders) {
      this.byChannel.set(sender.channel, sender);
    }
  }

  get(channel: OtpChannel): OtpDeliverySender {
    const sender = this.byChannel.get(channel);
    if (!sender) {
      throw new NotImplementedException(`Канал ${channel} не подключён`);
    }
    return sender;
  }
}
