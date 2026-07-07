import { OtpChannel } from '@prisma/client';

// Единый интерфейс отправителя OTP. Каждая реализация обслуживает один канал.
// Подключить реальный Telegram/SMS = добавить/заменить реализацию с этим интерфейсом,
// логика OtpService не меняется.
export interface OtpDeliverySender {
  readonly channel: OtpChannel;
  send(destination: string, code: string): Promise<void>;
}

// DI-токен для multi-provider: все senders собираются в массив по этому токену.
export const OTP_SENDERS = Symbol('OTP_SENDERS');
