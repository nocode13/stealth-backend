import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotSessionPurpose, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isStaffRole } from '../common/telegram-identity';

/** Исход привязки: под каждый — свой текст в чате, см. telegram-identity.ts. */
export type LinkSellerResult =
  | 'ok'
  | 'expired'
  | 'takenByCustomer'
  | 'takenByStaff';

export interface BotLinkCreated {
  nonce: string;
  botUrl: string;
  expiresIn: number;
}

export type LocationStatus =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'received'; latitude: number; longitude: number };

// Префикс в /start payload — по нему бот понимает, зачем его открыли.
const PREFIX: Record<BotSessionPurpose, string> = {
  [BotSessionPurpose.DELIVERY_LOCATION]: 'loc',
  [BotSessionPurpose.SELLER_LINK]: 'sel',
};

/**
 * Сессии «сходить в бота и вернуться» для уже авторизованного пользователя:
 * адрес доставки (покупатель) и привязка Telegram (продавец).
 *
 * Механика та же, что у входа (TelegramAuthService): nonce в диплинке + поллинг.
 * Отличие в том, что userId известен заранее, а не создаётся ботом, — поэтому
 * это отдельная модель BotLinkSession, а не переиспользование TelegramAuthSession.
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
    const botUsername = this.config.get<string>('telegram.botUsername');
    if (!botUsername) {
      throw new BadRequestException('Telegram-бот не сконфигурирован');
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

  // ─────────────────────────── адрес доставки ───────────────────────────

  /** Бот получил /start loc_<nonce>: помечаем, кто именно сейчас шлёт локацию. */
  async attachLocationRequest(nonce: string, telegramId: string): Promise<boolean> {
    const session = await this.findLive(nonce, BotSessionPurpose.DELIVERY_LOCATION);
    if (!session) return false;
    // Сверяем, что бота открыл владелец сессии, а не тот, кому переслали ссылку.
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { telegramId: true },
    });
    return user?.telegramId === telegramId;
  }

  /** Пришло message:location — кладём координаты в свежую сессию этого юзера. */
  async saveLocation(
    telegramId: string,
    latitude: number,
    longitude: number,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return false;

    const session = await this.prisma.botLinkSession.findFirst({
      where: {
        userId: user.id,
        purpose: BotSessionPurpose.DELIVERY_LOCATION,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return false;

    await this.prisma.botLinkSession.update({
      where: { id: session.id },
      data: { latitude, longitude },
    });
    return true;
  }

  /** Мобилка поллит, пока не придут координаты. Отдаём их ровно один раз. */
  async pollLocation(nonce: string, userId: string): Promise<LocationStatus> {
    const session = await this.prisma.botLinkSession.findUnique({
      where: { nonce },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.consumedAt ||
      session.expiresAt < new Date()
    ) {
      return { status: 'expired' };
    }
    if (session.latitude == null || session.longitude == null) {
      return { status: 'pending' };
    }

    // Условный claim, как в TelegramAuthService.poll: гонка двух поллеров
    // не должна отдать координаты дважды.
    const claimed = await this.prisma.botLinkSession.updateMany({
      where: { id: session.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) return { status: 'expired' };

    return {
      status: 'received',
      latitude: session.latitude,
      longitude: session.longitude,
    };
  }

  // ─────────────────────────── привязка продавца ───────────────────────────

  /**
   * Бот получил /start sel_<nonce>: пишем telegramId в аккаунт продавца.
   *
   * telegramId уникален, а личный Telegram продавца мог уже войти в мобилку
   * отдельным аккаунтом-покупателем. Тогда P2002 → 409 с внятным текстом,
   * а не 500.
   */
  async linkSeller(
    nonce: string,
    telegramId: string,
  ): Promise<LinkSellerResult> {
    const session = await this.findLive(nonce, BotSessionPurpose.SELLER_LINK);
    if (!session) return 'expired';

    // Разбираем, КЕМ занят Telegram, до апдейта: P2002 знает только «занято»,
    // а покупателю и владельцу другого магазина нужны разные объяснения.
    const occupant = await this.prisma.user.findUnique({ where: { telegramId } });
    if (occupant && occupant.id !== session.userId) {
      this.logger.warn(
        `Привязка отклонена: telegramId=${telegramId} занят ${occupant.role}-аккаунтом.`,
      );
      return isStaffRole(occupant.role) ? 'takenByStaff' : 'takenByCustomer';
    }

    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: session.userId },
          data: { telegramId },
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

  /** Обратная операция к linkSeller: освобождает telegramId. */
  async unlinkSeller(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { telegramId: null },
    });
  }

  /** Кидает 409, если этот Telegram уже занят другим пользователем. */
  async assertTelegramFree(telegramId: string, userId: string): Promise<void> {
    const owner = await this.prisma.user.findUnique({ where: { telegramId } });
    if (owner && owner.id !== userId) {
      throw new ConflictException('Этот Telegram уже привязан к другому аккаунту');
    }
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
