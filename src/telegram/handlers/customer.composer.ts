import { Injectable, Logger } from '@nestjs/common';
import { Composer } from 'grammy';
import type { Context } from 'grammy';
import { STAFF_CANNOT_SHOP } from '../../common/telegram-identity';
import { TelegramAuthService } from '../telegram-auth.service';
import { TelegramLinkService } from '../telegram-link.service';

const REPLY_BY_LOGIN_RESULT: Record<'ok' | 'expired' | 'staff', string> = {
  ok: 'Готово, вы вошли — возвращайтесь в приложение.',
  expired: 'Ссылка для входа устарела. Откройте приложение и попробуйте ещё раз.',
  staff: STAFF_CANNOT_SHOP,
};

/**
 * Хендлеры покупателя. Ровно то, что бот умел раньше, плюс приём геолокации.
 *
 * Ветка покупателя намеренно изолирована от кабинета продавца: сюда попадает всё,
 * что не относится к SELLER/SUPER_ADMIN, и её поведение не должно меняться от того,
 * что в боте появился кабинет.
 */
@Injectable()
export class CustomerComposer {
  private readonly logger = new Logger(CustomerComposer.name);

  constructor(
    private readonly telegramAuth: TelegramAuthService,
    private readonly links: TelegramLinkService,
  ) {}

  build(): Composer<Context> {
    const composer = new Composer();

    // /start <nonce> — вход в мобилку. /start loc_<nonce> — адрес доставки.
    // Оба payload'а приходят одной командой, поэтому развилка по префиксу.
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

      if (payload.startsWith('loc_')) {
        const ok = await this.links.attachLocationRequest(
          payload.slice('loc_'.length),
          String(ctx.from.id),
        );
        if (!ok) {
          await ctx.reply(
            'Ссылка устарела. Вернитесь в приложение и попробуйте ещё раз.',
          );
          return;
        }
        await ctx.reply('Нажмите кнопку ниже, чтобы отправить адрес доставки:', {
          reply_markup: {
            keyboard: [[{ text: '📍 Отправить локацию', request_location: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
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

    // Геопозиция для адреса доставки. Мобилка узнаёт о ней поллингом, как и о входе.
    composer.on('message:location', async (ctx) => {
      if (!ctx.from) return;
      const { latitude, longitude } = ctx.message.location;
      const saved = await this.links.saveLocation(
        String(ctx.from.id),
        latitude,
        longitude,
      );
      await ctx.reply(
        saved
          ? '📍 Адрес получен — возвращайтесь в приложение и оформляйте заказ.'
          : 'Не нашёл активный запрос адреса. Начните оформление заказа заново.',
        { reply_markup: { remove_keyboard: true } },
      );
    });

    return composer;
  }
}
