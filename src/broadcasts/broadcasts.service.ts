import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  BroadcastAudience,
  BroadcastStatus,
  NotificationType,
  Prisma,
  Role,
} from '@prisma/client';
import type { Broadcast, Locale } from '@prisma/client';
import type { ExpoPushMessage } from 'expo-server-sdk';
import { InlineKeyboard } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { TelegramNotifyService } from '../telegram/telegram-notify.service';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';
import { pickText, type LocalizedText } from '../i18n/localized-text';
import { toCursorPage, type CursorPage } from '../common/pagination';
import {
  BROADCAST_BODY_TEXT_MAX,
  type BroadcastAudienceDto,
  type CreateBroadcastDto,
  type FindBroadcastsQueryDto,
} from './dto/broadcast.dto';
import {
  escapeTelegramHtml,
  sanitizeBroadcastHtml,
  toPlainText,
  toTelegramHtml,
} from './telegram-html';

// Строки ленты пишем и доставку ведём пачками — чтобы не держать в памяти всю базу.
const BATCH = 500;
// ~25 сообщений в секунду: лимит Bot API — 30/с на бота, оставляем запас под
// уведомления о заказах, которые идут через того же бота параллельно.
const TG_INTERVAL_MS = 40;
const TG_MAX_RETRIES = 3;
// Баннер всё равно обрезает текст, а весь payload Expo ограничен 4 КБ.
const PUSH_BODY_MAX = 500;
// Канал должен существовать на устройстве, иначе Android 8+ не покажет пуш.
// Пока используем уже созданный мобилкой 'orders'; отдельный канал рассылок
// можно завести, когда сборка с ним разойдётся по юзерам.
const PUSH_CHANNEL_ID = 'orders';

export interface AudienceCount {
  total: number;
  withPush: number;
  withTelegram: number;
}

const WITH_AUTHOR = {
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BroadcastInclude;

export type BroadcastWithAuthor = Prisma.BroadcastGetPayload<{
  include: typeof WITH_AUTHOR;
}>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ручные рассылки покупателям: лента (Notification) + push + Telegram.
 *
 * Лента пишется синхронно в create() — это надёжный канал, ошибка там отдаётся
 * админу. Push и Telegram идут в фоне (`void this.deliver()`): очереди в проекте
 * нет, прод — одна реплика, так что фоновая работа в процессе допустима. Минус —
 * рестарт посреди доставки её обрывает; такие рассылки onModuleInit помечает FAILED.
 */
@Injectable()
export class BroadcastsService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly telegram: TelegramNotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.broadcast.updateMany({
      where: { status: BroadcastStatus.SENDING },
      data: { status: BroadcastStatus.FAILED, finishedAt: new Date() },
    });
    if (count > 0) {
      this.logger.warn(`Прерванных рестартом рассылок: ${count} → FAILED`);
    }
  }

  async findAll(
    query: FindBroadcastsQueryDto,
  ): Promise<CursorPage<BroadcastWithAuthor>> {
    const rows = await this.prisma.broadcast.findMany({
      include: WITH_AUTHOR,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOne(id: string): Promise<BroadcastWithAuthor> {
    const row = await this.prisma.broadcast.findUnique({
      where: { id },
      include: WITH_AUTHOR,
    });
    if (!row) throw new NotFoundException('Рассылка не найдена');
    return row;
  }

  /** Для подтверждения в админке: «Отправить N клиентам (push: X, Telegram: Y)?». */
  async countAudience(dto: BroadcastAudienceDto): Promise<AudienceCount> {
    const where = this.recipientsWhere(dto.audience, dto.recipientIds);
    const [total, withPush, withTelegram] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { ...where, pushTokens: { some: {} } } }),
      this.prisma.user.count({
        where: { ...where, telegramId: { not: null } },
      }),
    ]);
    return { total, withPush, withTelegram };
  }

  async create(
    dto: CreateBroadcastDto,
    adminId: string,
  ): Promise<BroadcastWithAuthor> {
    if (!dto.sendPush && !dto.sendTelegram) {
      throw new BadRequestException('Выберите хотя бы один канал');
    }

    const title = this.localized(dto.title);
    const body = this.localized(dto.body, sanitizeBroadcastHtml);
    const plainBody: LocalizedText = {};
    for (const [locale, html] of Object.entries(body)) {
      const text = toPlainText(html);
      if (text.length > BROADCAST_BODY_TEXT_MAX) {
        throw new BadRequestException(
          `Текст (${locale}) длиннее ${BROADCAST_BODY_TEXT_MAX} символов`,
        );
      }
      if (text) plainBody[locale] = text;
    }
    if (!title[DEFAULT_LOCALE] || !plainBody[DEFAULT_LOCALE]) {
      throw new BadRequestException('Заголовок и текст на русском обязательны');
    }
    const buttonText =
      dto.buttonText && dto.buttonUrl ? this.localized(dto.buttonText) : null;

    const broadcast = await this.prisma.broadcast.create({
      data: {
        createdById: adminId,
        title,
        body,
        buttonText: buttonText ?? Prisma.DbNull,
        buttonUrl: buttonText ? dto.buttonUrl : null,
        sendPush: dto.sendPush,
        sendTelegram: dto.sendTelegram,
        audience: dto.audience,
        recipientIds:
          dto.audience === BroadcastAudience.SELECTED
            ? (dto.recipientIds ?? [])
            : [],
      },
    });

    try {
      const recipientsCount = await this.writeFeed(broadcast, {
        broadcastId: broadcast.id,
        title,
        body: plainBody,
      });
      await this.prisma.broadcast.update({
        where: { id: broadcast.id },
        data: { recipientsCount },
      });
    } catch (e) {
      await this.finish(broadcast.id, BroadcastStatus.FAILED);
      throw e;
    }

    void this.deliver(broadcast.id);
    return this.findOne(broadcast.id);
  }

  private recipientsWhere(
    audience: BroadcastAudience,
    recipientIds?: string[],
  ): Prisma.UserWhereInput {
    return {
      role: Role.CUSTOMER,
      deletedAt: null,
      ...(audience === BroadcastAudience.SELECTED
        ? { id: { in: recipientIds ?? [] } }
        : {}),
    };
  }

  // Получатели фиксируются моментом создания: зарегистрировавшиеся во время
  // фоновой доставки не получат push/Telegram без строки в ленте.
  private broadcastRecipientsWhere(b: Broadcast): Prisma.UserWhereInput {
    return {
      ...this.recipientsWhere(b.audience, b.recipientIds),
      createdAt: { lte: b.createdAt },
    };
  }

  /** Пустые переводы не храним — pickText сам упадёт на RU. */
  private localized(
    value: Partial<Record<Locale, string>>,
    transform: (s: string) => string = (s) => s.trim(),
  ): LocalizedText {
    const result: LocalizedText = {};
    for (const locale of SUPPORTED_LOCALES) {
      const raw = value[locale];
      if (!raw) continue;
      const text = transform(raw);
      if (text) result[locale] = text;
    }
    return result;
  }

  private async writeFeed(
    broadcast: Broadcast,
    payload: Prisma.InputJsonObject,
  ): Promise<number> {
    const where = this.broadcastRecipientsWhere(broadcast);
    let count = 0;
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        take: BATCH,
      });
      if (users.length === 0) break;
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: NotificationType.BROADCAST,
          payload,
        })),
      });
      count += users.length;
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) break;
    }
    return count;
  }

  private async deliver(id: string): Promise<void> {
    try {
      const b = await this.prisma.broadcast.findUniqueOrThrow({
        where: { id },
      });
      const content = this.buildContent(b);
      const where = this.broadcastRecipientsWhere(b);

      let cursor: string | undefined;
      for (;;) {
        const users = await this.prisma.user.findMany({
          where,
          select: {
            id: true,
            locale: true,
            telegramId: true,
            pushTokens: { select: { token: true } },
          },
          orderBy: { id: 'asc' },
          cursor: cursor ? { id: cursor } : undefined,
          skip: cursor ? 1 : 0,
          take: BATCH,
        });
        if (users.length === 0) break;

        const stats = {
          pushSent: 0,
          pushFailed: 0,
          tgSent: 0,
          tgFailed: 0,
          tgBlocked: 0,
        };

        if (b.sendPush) {
          const messages: ExpoPushMessage[] = users.flatMap((u) => {
            const c = content[u.locale ?? DEFAULT_LOCALE];
            return u.pushTokens.map((t) => ({
              to: t.token,
              title: c.title,
              body: c.pushBody,
              data: { type: NotificationType.BROADCAST, broadcastId: b.id },
              sound: 'default' as const,
              channelId: PUSH_CHANNEL_ID,
            }));
          });
          if (messages.length > 0) {
            const res = await this.push.sendMany(messages);
            stats.pushSent += res.ok;
            stats.pushFailed += res.failed;
          }
        }

        if (b.sendTelegram) {
          for (const u of users) {
            if (!u.telegramId) continue;
            const c = content[u.locale ?? DEFAULT_LOCALE];
            const result = await this.sendTelegram(
              u.telegramId,
              c.telegramHtml,
              c.keyboard,
            );
            if (result === 'ok') stats.tgSent++;
            else if (result === 'blocked') stats.tgBlocked++;
            else stats.tgFailed++;
            await sleep(TG_INTERVAL_MS);
          }
        }

        await this.prisma.broadcast.update({
          where: { id },
          data: {
            pushSent: { increment: stats.pushSent },
            pushFailed: { increment: stats.pushFailed },
            tgSent: { increment: stats.tgSent },
            tgFailed: { increment: stats.tgFailed },
            tgBlocked: { increment: stats.tgBlocked },
          },
        });

        cursor = users[users.length - 1].id;
        if (users.length < BATCH) break;
      }

      await this.finish(id, BroadcastStatus.DONE);
    } catch (e) {
      this.logger.error(`Рассылка ${id} упала: ${String(e)}`);
      await this.finish(id, BroadcastStatus.FAILED).catch(() => undefined);
    }
  }

  /** Готовые тексты на каждый язык — считаем один раз, а не на каждого юзера. */
  private buildContent(b: Broadcast) {
    const content = {} as Record<
      Locale,
      {
        title: string;
        pushBody: string;
        telegramHtml: string;
        keyboard?: InlineKeyboard;
      }
    >;
    for (const locale of SUPPORTED_LOCALES) {
      const title = pickText(b.title, locale);
      const html = pickText(b.body, locale);
      const plain = toPlainText(html);
      const buttonText = b.buttonText ? pickText(b.buttonText, locale) : '';
      content[locale] = {
        title,
        pushBody:
          plain.length > PUSH_BODY_MAX
            ? `${plain.slice(0, PUSH_BODY_MAX - 1)}…`
            : plain,
        telegramHtml: `<b>${escapeTelegramHtml(title)}</b>\n\n${toTelegramHtml(html)}`,
        keyboard:
          buttonText && b.buttonUrl
            ? new InlineKeyboard().url(buttonText, b.buttonUrl)
            : undefined,
      };
    }
    return content;
  }

  private async sendTelegram(
    chatId: string,
    html: string,
    keyboard?: InlineKeyboard,
  ): Promise<'ok' | 'blocked' | 'error'> {
    for (let attempt = 0; attempt <= TG_MAX_RETRIES; attempt++) {
      const res = await this.telegram.sendBroadcastToCustomer(
        chatId,
        html,
        keyboard,
      );
      if (res.status !== 'retry') return res.status;
      await sleep(res.retryAfter * 1000);
    }
    return 'error';
  }

  private async finish(id: string, status: BroadcastStatus): Promise<void> {
    await this.prisma.broadcast.update({
      where: { id },
      data: { status, finishedAt: new Date() },
    });
  }
}
