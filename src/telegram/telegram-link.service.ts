import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotSessionPurpose, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Исход привязки: под каждый — свой текст в чате, см. telegram-identity.ts. */
export type LinkSellerResult = 'ok' | 'expired' | 'takenByStaff';

export interface BotLinkCreated {
  nonce: string;
  botUrl: string;
  expiresIn: number;
}

// Префикс в /start payload — по нему бот понимает, зачем его открыли.
const PREFIX: Record<BotSessionPurpose, string> = {
  [BotSessionPurpose.SELLER_LINK]: 'sel',
};

/**
 * Сессия «сходить в бота продавца и вернуться» для уже авторизованного
 * пользователя — привязка его Telegram к рабочему аккаунту. (Раньше сюда же входил адрес доставки покупателя —
 * тот флоу выпилен в пользу пикера карты, см. stealth-mobile.)
 *
 * Механика та же, что у входа (TelegramAuthService): nonce в диплинке + поллинг.
 * Отличие в том, что userId известен заранее, а не создаётся ботом, — поэтому
 * это отдельная модель BotLinkSession, а не переиспользование TelegramAuthSession.
 *
 * Именно потому, что userId — параметр, а не «текущий пользователь», сессию можно
 * выписать и на чужой аккаунт: так владелец приглашает сотрудника в команду
 * (SellerStaffService.invite), и тому не нужен вход в админку.
 */
@Injectable()
export class TelegramLinkService {
  private readonly logger = new Logger(TelegramLinkService.name);
  // Больше, чем 180 с у входа: тут пользователю нужно сделать два тапа.
  private readonly ttlSeconds = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createSession(
    userId: string,
    purpose: BotSessionPurpose,
  ): Promise<BotLinkCreated> {
    // Привязка ведёт в бот ПРОДАВЦА: кабинет и уведомления живут там.
    const botUsername = this.config.get<string>('telegramSeller.botUsername');
    if (!botUsername) {
      throw new BadRequestException('Бот продавца не сконфигурирован');
    }

    const nonce = randomBytes(18).toString('base64url');
    await this.prisma.botLinkSession.create({
      data: {
        nonce,
        purpose,
        userId,
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      },
    });

    return {
      nonce,
      botUrl: `https://t.me/${botUsername}?start=${PREFIX[purpose]}_${nonce}`,
      expiresIn: this.ttlSeconds,
    };
  }

  // ─────────────────────────── привязка продавца ───────────────────────────

  /**
   * Бот продавца получил /start sel_<nonce>: пишем staffTelegramId в его аккаунт.
   *
   * Покупательская учётка с тем же Telegram привязке не мешает — она живёт в
   * другой колонке. А вот второй рабочий аккаунт на тот же Telegram нельзя:
   * staffTelegramId уникален, тогда P2002 → внятный текст, а не 500.
   */
  async linkSeller(
    nonce: string,
    staffTelegramId: string,
  ): Promise<LinkSellerResult> {
    const session = await this.findLive(nonce, BotSessionPurpose.SELLER_LINK);
    if (!session) return 'expired';

    const occupant = await this.prisma.user.findUnique({
      where: { staffTelegramId },
    });
    if (occupant && occupant.id !== session.userId) {
      this.logger.warn(
        `Привязка отклонена: staffTelegramId=${staffTelegramId} занят ${occupant.role}-аккаунтом.`,
      );
      return 'takenByStaff';
    }

    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: session.userId },
          data: { staffTelegramId },
        }),
        this.prisma.botLinkSession.update({
          where: { id: session.id },
          data: { consumedAt: new Date() },
        }),
      ]);
      return 'ok';
    } catch (error) {
      // Гонка между проверкой выше и апдейтом — редкая, но возможная.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'takenByStaff';
      }
      throw error;
    }
  }

  /** Обратная операция к linkSeller: освобождает staffTelegramId. */
  async unlinkSeller(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { staffTelegramId: null },
    });
  }

  private async findLive(nonce: string, purpose: BotSessionPurpose) {
    const session = await this.prisma.botLinkSession.findUnique({
      where: { nonce },
    });
    if (
      !session ||
      session.purpose !== purpose ||
      session.consumedAt ||
      session.expiresAt < new Date()
    ) {
      return null;
    }
    return session;
  }
}
