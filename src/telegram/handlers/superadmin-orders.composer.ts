import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Role, type User } from '@prisma/client';
import { Composer } from 'grammy';
import type { Context } from 'grammy';
import type { AuthPrincipal } from '../../common/decorators/current-user.decorator';
import { OrderNotifier } from '../../orders/order-notifier.service';
import { OrdersService } from '../../orders/orders.service';
import { PrismaService } from '../../prisma/prisma.service';

const STATUS_CALLBACK =
  /^grp:(.+):(NEW|CONFIRMED|ASSEMBLING|DELIVERING|ARRIVED|DELIVERED|CANCELLED)$/;

/**
 * Кнопки статуса ГРУППЫ в сводной карточке SUPER_ADMIN (см.
 * OrderNotifier.buildSuperAdminGroupCard/groupCreatedForSuperAdmins).
 * Отдельный файл от seller.composer.ts, чтобы его read-only-гарантия для
 * SELLER осталась буквально нетронутой — оба композера накладываются на один
 * и тот же бот продавца (см. telegram-bot.service.ts), не зная друг о друге.
 *
 * ВАЖНО ПРО БЕЗОПАСНОСТЬ: как и в seller.composer.ts, `callback_data` — данные
 * от клиента, их можно подделать или нажать кнопку из пересланного сообщения.
 * Роль перепроверяется на КАЖДЫЙ колбэк заново через resolveSuperAdmin, SELLER
 * до OrdersService.changeGroupStatus в принципе не долетает.
 */
@Injectable()
export class SuperAdminOrdersComposer {
  private readonly logger = new Logger(SuperAdminOrdersComposer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifier: OrderNotifier,
  ) {}

  build(): Composer<Context> {
    const composer = new Composer();

    composer.callbackQuery(STATUS_CALLBACK, async (ctx) => {
      await ctx.answerCallbackQuery();

      const principal = await this.resolveSuperAdmin(ctx);
      if (!principal) {
        await ctx.answerCallbackQuery({
          text: 'Доступ запрещён',
          show_alert: true,
        });
        return;
      }

      const [, groupId, status] = ctx.match;
      try {
        const group = await this.orders.changeGroupStatus(principal, groupId, {
          status: status as OrderStatus,
        });
        const { text, keyboard } =
          this.notifier.buildSuperAdminGroupCard(group);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch (error) {
        await ctx.answerCallbackQuery({
          text: this.errorText(error),
          show_alert: true,
        });
        // Даже при отказе перестраиваем карточку по актуальному состоянию:
        // другой SUPER_ADMIN мог уже применить свой статус раньше, и кнопки
        // на этой копии сообщения — устаревшие.
        await this.refreshCard(principal, groupId, ctx);
      }
    });

    return composer;
  }

  private async refreshCard(
    principal: AuthPrincipal,
    groupId: string,
    ctx: Context,
  ): Promise<void> {
    try {
      const group = await this.orders.findOneGroupForStaff(principal, groupId);
      const { text, keyboard } = this.notifier.buildSuperAdminGroupCard(group);
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error) {
      this.logger.error(
        `Не удалось обновить карточку группы ${groupId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Кто нажал кнопку. Ищем по `staffTelegramId`, но, в отличие от
   * resolveSeller в seller.composer.ts, роль SELLER сюда не допускается вовсе.
   */
  private async resolveSuperAdmin(ctx: Context): Promise<AuthPrincipal | null> {
    if (!ctx.from) return null;
    const user: User | null = await this.prisma.user.findUnique({
      where: { staffTelegramId: String(ctx.from.id) },
    });
    if (!user || user.role !== Role.SUPER_ADMIN) return null;
    return { id: user.id, role: user.role, sellerId: user.sellerId };
  }

  private errorText(error: unknown): string {
    const response = (error as { response?: { message?: string | string[] } })
      ?.response;
    const message = response?.message;
    if (Array.isArray(message)) return message.join('\n');
    if (typeof message === 'string') return message;
    this.logger.error(`Ошибка при смене статуса группы: ${String(error)}`);
    return 'Что-то пошло не так, попробуйте ещё раз.';
  }
}
