import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { OtpDeliverySender } from './otp-sender.interface';

// Реальная доставка кода на email через Gmail SMTP (nodemailer).
// Если SMTP не сконфигурирован (dev) — фолбэк: код пишется в лог.
@Injectable()
export class EmailOtpSender implements OtpDeliverySender {
  readonly channel = OtpChannel.EMAIL;
  private readonly logger = new Logger(EmailOtpSender.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('mail.host');
    const user = this.config.get<string>('mail.user');
    const pass = this.config.get<string>('mail.pass');
    this.from = this.config.get<string>('mail.from')!;

    // Транспорт создаём только если заданы креды, иначе работаем в режиме лога.
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('mail.port'),
        secure: this.config.get<number>('mail.port') === 465,
        auth: { user, pass },
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        'SMTP не сконфигурирован — email OTP будет писаться в лог (dev-режим).',
      );
    }
  }

  async send(destination: string, code: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV email OTP] ${destination} → код ${code}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to: destination,
      subject: 'Код входа',
      text: `Ваш код входа: ${code}`,
      html: `<p>Ваш код входа: <b>${code}</b></p>`,
    });
  }
}
