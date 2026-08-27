import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { loginCodeEmail } from './templates/login-code';

/**
 * Отправка почты через Resend. По образцу src/push/ и telegram-notify.module.ts:
 * только исходящие, ничего не импортирует, циклов не создаёт.
 *
 * Пустой RESEND_API_KEY — не ошибка старта (тот же приём, что с
 * TELEGRAM_BOT_TOKEN/REDIS_URL): клиент не создаётся, в лог уходит warning,
 * а sendLoginCode бросает исключение — вызывающий (EmailAuthService) превращает
 * его в 400/502.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from?: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('mail.resendApiKey');
    this.from = config.get<string>('mail.from');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn('RESEND_API_KEY не задан — вход по почте отключён');
    }
  }

  get enabled(): boolean {
    return this.resend !== null;
  }

  // ⚠️ SDK не кидает исключений — resend.emails.send() возвращает { data, error }.
  // Ветку error обязательно проверять, иначе провал отправки выглядит как успех.
  async sendLoginCode(to: string, code: string): Promise<void> {
    if (!this.resend) {
      throw new Error('Resend не сконфигурирован');
    }

    const { subject, html, text } = loginCodeEmail(code);
    const { error } = await this.resend.emails.send({
      from: this.from!,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      this.logger.error(
        `Не удалось отправить письмо на ${to}: ${error.message}`,
      );
      throw new Error(`Resend: ${error.message}`);
    }
  }
}
