import { Injectable } from '@nestjs/common';
import { Composer } from 'grammy';
import type { Context } from 'grammy';
import { TelegramAuthService } from '../telegram-auth.service';

const REPLY_BY_LOGIN_RESULT: Record<'ok' | 'expired', string> = {
  ok: 'Готово, вы вошли — возвращайтесь в приложение.',
  expired:
    'Ссылка для входа устарела. Откройте приложение и попробуйте ещё раз.',
};

/**
 * Хендлеры покупателя — живут в ОСНОВНОМ боте (кабинет продавца в своём, см.
 * seller.composer.ts). Единственный способ входа в мобилку через бот —
 * `/start <nonce>`, юзер уже подтверждён самим фактом нажатия Start. Вход по
 * номеру телефона (кнопка «Поделиться номером», OTP) выпилен — вместо него
 * код на почту (EmailAuthService), бот в нём не участвует вовсе.
 */
@Injectable()
export class CustomerComposer {
  constructor(private readonly telegramAuth: TelegramAuthService) {}

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

      const result = await this.telegramAuth.confirm(payload, ctx.from);
      await ctx.reply(REPLY_BY_LOGIN_RESULT[result]);
    });

    return composer;
  }
}
