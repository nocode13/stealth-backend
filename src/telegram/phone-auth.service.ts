import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { AuthService, TokenPair } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { displayName, type TelegramUser } from './telegram-auth.service';

export interface PhoneSessionCreated {
  nonce: string;
  /** Ссылка на основной бот; null — код уже «отправлен» (тестовый аккаунт). */
  botUrl: string | null;
  expiresIn: number;
  /** true → шаг с ботом пропускается, сразу вводим код. */
  codeSent: boolean;
}

export type PhoneSessionStatus = {
  status: 'pending' | 'code_sent' | 'mismatch' | 'expired';
};

/** Исход шага «поделиться контактом» в боте. */
export type ContactResult =
  | { result: 'ok'; code: string }
  | { result: 'mismatch' | 'no_session' | 'not_own' };

/** Сколько сессий на один номер разрешено за окно — примитивный анти-флуд. */
const MAX_SESSIONS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
/** После стольких неверных кодов сессия гаснет. */
const MAX_ATTEMPTS = 5;

/**
 * Вход по номеру телефона.
 *
 * Номер, введённый в мобилке, сам по себе ничего не доказывает — иначе любой занял
 * бы чужой (`User.phone` уникален и уходит в снапшоты заказов). Поэтому номер
 * подтверждается в основном боте кнопкой «Поделиться номером» (`request_contact`):
 * Telegram отдаёт настоящий номер аккаунта, мы сверяем его с заявленным, и только
 * при совпадении бот присылает OTP. То есть OTP тут — не канал доставки «вместо
 * SMS», а доказательство, что человек с подтверждённым номером вернулся в то же
 * приложение, где начал вход.
 *
 * Отдельная ветка — тестовый аккаунт для проверки в Play Store: у ревьюера нет
 * доступа к нашему боту, поэтому с TEST_LOGIN_PHONE шаг с Telegram пропускается,
 * а кодом служит вечный TEST_LOGIN_OTP.
 */
@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    return this.config.get<number>('telegram.phoneAuthTtlSeconds') ?? 600;
  }

  /** Тестовый вход включён, только когда заданы ОБЕ переменные. */
  private get testLogin(): { phone: string; otp: string } | null {
    const phone = this.config.get<string>('testLogin.phone');
    const otp = this.config.get<string>('testLogin.otp');
    if (!phone || !otp) return null;
    return { phone: normalizePhone(phone), otp };
  }

  // Шаг 1: мобилка заявляет номер и получает ссылку на бота.
  async createSession(rawPhone: string): Promise<PhoneSessionCreated> {
    const phone = normalizePhone(rawPhone);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    const test = this.testLogin;
    if (test && phone === test.phone) {
      return this.createTestSession(test, expiresAt);
    }

    await this.assertNotFlooding(phone);

    const botUsername = this.config.get<string>('telegram.botUsername');
    if (!botUsername) {
      throw new BadRequestException('Telegram-бот не сконфигурирован');
    }

    const nonce = randomBytes(24).toString('base64url');
    await this.prisma.phoneAuthSession.create({
      data: { nonce, phone, expiresAt },
    });

    return {
      nonce,
      botUrl: `https://t.me/${botUsername}?start=otp_${nonce}`,
      expiresIn: this.ttlSeconds,
      codeSent: false,
    };
  }

  // Шаг 2 (мобилка поллит): дождались ли мы подтверждения номера в боте.
  async poll(nonce: string): Promise<PhoneSessionStatus> {
    const session = await this.prisma.phoneAuthSession.findUnique({
      where: { nonce },
    });
    if (!session) return { status: 'expired' };
    // mismatch проверяем до consumedAt: несовпадение сессию как раз и гасит,
    // но клиенту нужно показать именно причину, а не «ссылка устарела».
    if (session.mismatch) return { status: 'mismatch' };
    if (session.consumedAt || session.expiresAt < new Date()) {
      return { status: 'expired' };
    }
    return { status: session.codeHash ? 'code_sent' : 'pending' };
  }

  // Шаг 2а: бот получил /start otp_<nonce>. Кто именно нажал — запоминаем,
  // по этому telegramId контакт потом найдёт свою сессию.
  async attachTelegram(
    nonce: string,
    from: TelegramUser,
  ): Promise<'ask_contact' | 'expired'> {
    const session = await this.prisma.phoneAuthSession.findUnique({
      where: { nonce },
    });
    if (
      !session ||
      session.consumedAt ||
      session.mismatch ||
      session.expiresAt < new Date()
    ) {
      return 'expired';
    }

    await this.prisma.phoneAuthSession.update({
      where: { id: session.id },
      data: { telegramId: String(from.id), name: displayName(from) },
    });
    return 'ask_contact';
  }

  // Шаг 2б: юзер поделился контактом. Сверяем номер и выдаём код.
  async confirmContact(
    telegramId: string,
    contactPhone: string,
    contactUserId?: number,
  ): Promise<ContactResult> {
    // Чужой контакт можно переслать — принимаем только свой собственный.
    if (contactUserId == null || String(contactUserId) !== telegramId) {
      return { result: 'not_own' };
    }

    const session = await this.prisma.phoneAuthSession.findFirst({
      where: {
        telegramId,
        codeHash: null,
        consumedAt: null,
        mismatch: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return { result: 'no_session' };

    if (normalizePhone(contactPhone) !== session.phone) {
      // Гасим сразу: продолжать этот вход нельзя, мобилка покажет причину.
      await this.prisma.phoneAuthSession.update({
        where: { id: session.id },
        data: { mismatch: true, consumedAt: new Date() },
      });
      return { result: 'mismatch' };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.phoneAuthSession.update({
      where: { id: session.id },
      data: { codeHash: hash(code) },
    });
    return { result: 'ok', code };
  }

  // Шаг 3: мобилка присылает код. Токены выдаются ровно один раз.
  async verify(nonce: string, code: string): Promise<TokenPair> {
    const session = await this.prisma.phoneAuthSession.findUnique({
      where: { nonce },
    });
    if (
      !session ||
      session.consumedAt ||
      session.mismatch ||
      session.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Сессия входа устарела, начните заново');
    }
    if (!session.codeHash) {
      throw new UnauthorizedException('Номер ещё не подтверждён в боте');
    }
    if (session.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException('Слишком много попыток, начните заново');
    }

    if (!safeEqual(hash(code), session.codeHash)) {
      const { attempts } = await this.prisma.phoneAuthSession.update({
        where: { id: session.id },
        data: { attempts: { increment: 1 } },
      });
      if (attempts >= MAX_ATTEMPTS) {
        await this.prisma.phoneAuthSession.update({
          where: { id: session.id },
          data: { consumedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Неверный код');
    }

    // Тот же приём, что в TelegramAuthService.poll: гонка двух запросов не должна
    // выдать две пары токенов.
    const claimed = await this.prisma.phoneAuthSession.updateMany({
      where: { id: session.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException('Сессия входа уже использована');
    }

    const user = await this.resolveUser(session);
    return this.auth.issueTokens(user.id);
  }

  /**
   * Кому выдаём токены. Политика строгая: учётки не сливаются и номер не
   * «переезжает» — конфликт превращается в 409, а не в тихую перезапись.
   */
  private async resolveUser(session: {
    userId: string | null;
    telegramId: string | null;
    phone: string;
    name: string | null;
  }): Promise<User> {
    if (session.userId) {
      const user = await this.users.findById(session.userId);
      if (!user) throw new UnauthorizedException('Пользователь не найден');
      return user;
    }

    const telegramId = session.telegramId;
    if (!telegramId) {
      throw new UnauthorizedException('Номер не подтверждён в боте');
    }

    try {
      // Номер верифицирован самим Telegram, значит он принадлежит владельцу
      // этого аккаунта — дописываем его покупательской учётке.
      const byTelegram = await this.users.findByTelegramId(telegramId);
      if (byTelegram) {
        if (byTelegram.phone === session.phone) return byTelegram;
        return await this.prisma.user.update({
          where: { id: byTelegram.id },
          data: { phone: session.phone },
        });
      }

      const byPhone = await this.users.findByPhone(session.phone);
      if (byPhone) {
        if (byPhone.telegramId) {
          // Номер тот же, а Telegram другой — молча переклеивать личности нельзя.
          throw new ConflictException(
            'Этот номер уже привязан к другому аккаунту',
          );
        }
        return await this.prisma.user.update({
          where: { id: byPhone.id },
          data: { telegramId, name: byPhone.name ?? session.name },
        });
      }

      return await this.users.createFromPhoneLogin({
        telegramId,
        phone: session.phone,
        name: session.name,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Бэкстоп на гонку: между чтением и записью номер/Telegram кто-то занял.
        throw new ConflictException(
          'Этот номер уже привязан к другому аккаунту',
        );
      }
      throw e;
    }
  }

  /**
   * Тестовый аккаунт Play Store: бот не участвует, код известен заранее.
   * Юзера заводим лениво, чтобы сид оставался чистым (в нём только супер-админ).
   */
  private async createTestSession(
    test: { phone: string; otp: string },
    expiresAt: Date,
  ): Promise<PhoneSessionCreated> {
    let user = await this.users.findByPhone(test.phone);
    user ??= await this.users.createFromPhoneLogin({
      telegramId: null,
      phone: test.phone,
      name: 'Test Account',
      role: Role.CUSTOMER,
    });

    const nonce = randomBytes(24).toString('base64url');
    await this.prisma.phoneAuthSession.create({
      data: {
        nonce,
        phone: test.phone,
        codeHash: hash(test.otp),
        userId: user.id,
        expiresAt,
      },
    });
    this.logger.log(`Тестовый вход по номеру ${test.phone}`);

    return {
      nonce,
      botUrl: null,
      expiresIn: this.ttlSeconds,
      codeSent: true,
    };
  }

  /** Примитивный анти-флуд по номеру: throttler в проекте нет. */
  private async assertNotFlooding(phone: string): Promise<void> {
    const recent = await this.prisma.phoneAuthSession.count({
      where: {
        phone,
        createdAt: { gt: new Date(Date.now() - RATE_WINDOW_MS) },
      },
    });
    if (recent >= MAX_SESSIONS_PER_WINDOW) {
      this.logger.warn(`Слишком частые попытки входа по номеру ${phone}`);
      throw new HttpException(
        'Слишком много попыток входа. Попробуйте позже.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/** К единому виду `+998…`: Telegram отдаёт номер и без плюса. */
export function normalizePhone(phone: string): string {
  return `+${phone.replace(/\D/g, '')}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
