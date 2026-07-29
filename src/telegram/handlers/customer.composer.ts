import { Injectable, Logger } from '@nestjs/common';
import { Composer } from 'grammy';
import type { Context } from 'grammy';
import { STAFF_CANNOT_SHOP } from '../../common/telegram-identity';
import { TelegramAuthService } from '../telegram-auth.service';

const REPLY_BY_LOGIN_RESULT: Record<'ok' | 'expired' | 'staff', string> = {
  ok: 'Готово, вы вошли — возвращайтесь в приложение.',
  expired:
    'Ссылка для входа устарела. Откройте приложение и попробуйте ещё раз.',
  staff: STAFF_CANNOT_SHOP,
};

/**
 * Хендлеры покупателя. Ровно то, что бот умел раньше (адрес доставки теперь
 * приходит из пикера карты в мобилке, а не отсюда).
 *
 * Ветка покупателя намеренно изолирована от кабинета продавца: сюда попадает всё,
 * что не относится к SELLER/SUPER_ADMIN, и её поведение не должно меняться от того,
 * что в боте появился кабинет.
 */
@Injectable()
export class CustomerComposer {
  private readonly logger = new Logger(CustomerComposer.name);

  constructor(private readonly telegramAuth: TelegramAuthService) {}

  build(): Composer<Context> {
    const composer = new Composer();

    // /start <nonce> — вход в мобилку. /start sel_<nonce> — привязка продавца.
    composer.command('start', async (ctx, next) => {
      const payload = ctx.match?.trim();
      if (!ctx.from) return;

      // Без payload команду разбирает seller.composer (меню кабинета) — он стоит
      // раньше в цепочке; если мы сюда дошли, значит юзер не продавец.
      if (!payload) {
        await ctx.reply(
          'Привет! Чтобы войти, откройте приложение и нажмите «Войти через Telegram».',
        );
        return;
      }

      if (payload.startsWith('sel_')) {
        // Привязку продавца обрабатывает seller.composer — сюда не дошло бы,
        // но пропускаем дальше на всякий случай.
        return next();
      }

      const result = await this.telegramAuth.confirm(payload, ctx.from);
      await ctx.reply(REPLY_BY_LOGIN_RESULT[result]);
    });

    return composer;
  }
}
