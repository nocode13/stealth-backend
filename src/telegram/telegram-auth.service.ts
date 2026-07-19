import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AuthService, TokenPair } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

// Данные пользователя, приходящие от Telegram (и из /start, и из initData).
export interface TelegramUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramSessionCreated {
  nonce: string;
  botUrl: string;
  expiresIn: number;
}

export type TelegramSessionStatus =
  | { status: 'pending' }
  | { status: 'expired' }
  | ({ status: 'confirmed' } & TokenPair);

// Собирает имя из того, что дал Telegram. Пустая строка → null (имя не обязательно).
function displayName(user: TelegramUser): string | null {
  const full = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return full || user.username || null;
}

@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    return this.config.get<number>('telegram.authSessionTtlSeconds') ?? 180;
  }

  // Шаг 1: мобилка просит сессию и получает ссылку на бота с nonce внутри.
  async createSession(): Promise<TelegramSessionCreated> {
    const botUsername = this.config.get<string>('telegram.botUsername');
    if (!botUsername) {
      throw new BadRequestException('Telegram-бот не сконфигурирован');
    }

    const nonce = randomBytes(24).toString('base64url');
    const expiresIn = this.ttlSeconds;
    await this.prisma.telegramAuthSession.create({
      data: { nonce, expiresAt: new Date(Date.now() + expiresIn * 1000) },
    });

    return {
      nonce,
      botUrl: `https://t.me/${botUsername}?start=${nonce}`,
      expiresIn,
    };
  }

  // Шаг 2: бот получил /start <nonce> — привязываем к сессии живого юзера.
  // Возвращает false, если сессия не найдена/просрочена (бот скажет об этом в чат).
  async confirm(nonce: string, from: TelegramUser): Promise<boolean> {
    const session = await this.prisma.telegramAuthSession.findUnique({
      where: { nonce },
    });
    if (!session || session.consumedAt || session.expiresAt < new Date()) {
      return false;
    }

    const telegramId = String(from.id);
    let user = await this.users.findByTelegramId(telegramId);
    user ??= await this.users.createFromTelegram({
      telegramId,
      name: displayName(from),
    });

    await this.prisma.telegramAuthSession.update({
      where: { id: session.id },
      data: { telegramId, userId: user.id },
    });
    return true;
  }

  // Шаг 3: мобилка поллит. Токены отдаём ровно один раз — consumedAt ставится
  // условным updateMany, поэтому гонка двух поллеров не выдаст две пары.
  async poll(nonce: string): Promise<TelegramSessionStatus> {
    const session = await this.prisma.telegramAuthSession.findUnique({
      where: { nonce },
    });
    if (!session || session.consumedAt || session.expiresAt < new Date()) {
      return { status: 'expired' };
    }
    if (!session.userId) return { status: 'pending' };

    const claimed = await this.prisma.telegramAuthSession.updateMany({
      where: { id: session.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    // Ноль строк — кто-то забрал токены между findUnique и updateMany.
    if (claimed.count === 0) return { status: 'expired' };

    const tokens = await this.auth.issueTokens(session.userId);
    return { status: 'confirmed', ...tokens };
  }

  // Вход из Mini App: initData подписана токеном бота, проверяем HMAC сами.
  // Схема: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
  async loginWithInitData(initData: string): Promise<TokenPair> {
    const botToken = this.config.get<string>('telegram.botToken');
    if (!botToken) {
      throw new BadRequestException('Telegram-бот не сконфигурирован');
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) throw new UnauthorizedException('initData без подписи');
    params.delete('hash');

    const checkString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = createHmac('sha256', secret)
      .update(checkString)
      .digest('hex');

    if (!this.safeEqual(expected, hash)) {
      throw new UnauthorizedException('Неверная подпись initData');
    }

    // auth_date защищает от переиспользования давно перехваченной строки.
    const authDate = Number(params.get('auth_date') ?? 0);
    const ageSeconds = Date.now() / 1000 - authDate;
    if (!authDate || ageSeconds > this.ttlSeconds) {
      throw new UnauthorizedException(
        'initData устарела, переоткройте приложение',
      );
    }

    const rawUser = params.get('user');
    if (!rawUser) throw new UnauthorizedException('initData без пользователя');

    let tgUser: TelegramUser;
    try {
      tgUser = JSON.parse(rawUser) as TelegramUser;
    } catch {
      throw new UnauthorizedException(
        'Не удалось разобрать пользователя initData',
      );
    }

    this.logger.log(`Mini App login: telegramId=${tgUser.id}`);
    return this.auth.loginWithTelegram({
      telegramId: String(tgUser.id),
      name: displayName(tgUser),
    });
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
