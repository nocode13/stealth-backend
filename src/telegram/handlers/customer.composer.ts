import { Injectable, Logger } from '@nestjs/common';
import { Composer, Keyboard } from 'grammy';
import type { Context } from 'grammy';
import { PhoneAuthService } from '../phone-auth.service';
import { TelegramAuthService } from '../telegram-auth.service';

const OTP_PREFIX = 'otp_';

const REPLY_BY_LOGIN_RESULT: Record<'ok' | 'expired', string> = {
  ok: 'Готово, вы вошли — возвращайтесь в приложение.',
  expired:
    'Ссылка для входа устарела. Откройте приложение и попробуйте ещё раз.',
};

const CONTACT_KEYBOARD = new Keyboard()
  .requestContact('📱 Поделиться номером')
  .oneTime()
  .resized();

/**
 * Хендлеры покупателя — живут в ОСНОВНОМ боте (кабинет продавца в своём, см.
 * seller.composer.ts). Здесь два способа входа в мобилку:
 *
 * - `/start <nonce>` — вход через Telegram, юзер уже подтверждён самим фактом
 *   нажатия Start;
 * - `/start otp_<nonce>` — вход по номеру телефона. Тут одного Start мало:
 *   заявленный в приложении номер надо ещё сверить с настоящим, поэтому просим
 *   поделиться контактом и только после совпадения присылаем код.
 */
@Injectable()
export class CustomerComposer {
  private readonly logger = new Logger(CustomerComposer.name);

  constructor(
    private readonly telegramAuth: TelegramAuthService,
    private readonly phoneAuth: PhoneAuthService,
  ) {}

  build(): Composer<Context> {
    const composer = new Composer();

    composer.command('start', async (ctx) => {
      const payload = ctx.match?.trim();
      if (!ctx.from) return;

      if (!payload) {
        await ctx.reply(
          'Привет! Чтобы войти, откройте приложение и выберите способ входа.',
        );
        return;
      }

      if (payload.startsWith(OTP_PREFIX)) {
        const result = await this.phoneAuth.attachTelegram(
          payload.slice(OTP_PREFIX.length),
          ctx.from,
        );
        if (result === 'expired') {
          await ctx.reply(REPLY_BY_LOGIN_RESULT.expired);
          return;
        }
        await ctx.reply(
          'Подтвердите, что номер ваш — нажмите кнопку ниже. ' +
            'После этого пришлю код для входа.',
          { reply_markup: CONTACT_KEYBOARD },
        );
        return;
      }

      const result = await this.telegramAuth.confirm(payload, ctx.from);
      await ctx.reply(REPLY_BY_LOGIN_RESULT[result]);
    });

    // Ответ на кнопку «Поделиться номером».
    composer.on('message:contact', async (ctx) => {
      if (!ctx.from) return;
      const contact = ctx.message.contact;

      const outcome = await this.phoneAuth.confirmContact(
        String(ctx.from.id),
        contact.phone_number,
        contact.user_id,
      );

      if (outcome.result === 'ok') {
        await ctx.reply(
          `Ваш код для входа: <b>${outcome.code}</b>\n\nВведите его в приложении.`,
          { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } },
        );
        return;
      }

      this.logger.warn(
        `Подтверждение номера отклонено (${outcome.result}): telegramId=${ctx.from.id}`,
      );
      await ctx.reply(CONTACT_ERRORS[outcome.result], {
        reply_markup: { remove_keyboard: true },
      });
    });

    return composer;
  }
}

const CONTACT_ERRORS: Record<'mismatch' | 'no_session' | 'not_own', string> = {
  mismatch:
    'Этот номер не совпадает с тем, что вы ввели в приложении. ' +
    'Откройте приложение и начните вход заново с правильным номером.',
  no_session:
    'Не нашёл активного входа. Откройте приложение, введите номер и перейдите по ссылке ещё раз.',
  not_own:
    'Нужен именно ваш контакт — нажмите кнопку «Поделиться номером», а не пересылайте чужой.',
};
