import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { normalizeEmail } from '../common/email';
import { isTestAccount } from '../common/test-account';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthService, TokenPair } from './auth.service';

export interface EmailSessionCreated {
  nonce: string;
  expiresIn: number;
}

/** Сколько сессий на один адрес разрешено за окно — тот же анти-флуд, что был у входа по номеру. */
const MAX_SESSIONS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
/** После стольких неверных кодов сессия гаснет. */
const MAX_ATTEMPTS = 5;

/**
 * Вход по коду на почту. В отличие от бывшего PhoneAuthService, промежуточного
 * шага тут нет: код генерится сразу при создании сессии и уходит в письмо
 * (Resend), поэтому ни поллинга, ни mismatch не существует в принципе.
 *
 * Живёт в AuthModule, а не в src/telegram/ — у входа по почте нет ни одной
 * зависимости от бота.
 */
@Injectable()
export class EmailAuthService {
  private readonly logger = new Logger(EmailAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    return this.config.get<number>('mail.authSessionTtlSeconds') ?? 600;
  }

  /** Тестовый вход включён, только когда заданы ОБЕ переменные. */
  private get testLogin(): { email: string; otp: string } | null {
    const email = this.config.get<string>('testLogin.email');
    const otp = this.config.get<string>('testLogin.otp');
    if (!email || !otp) return null;
    return { email: normalizeEmail(email), otp };
  }

  // Шаг 1 (вход): мобилка заявляет адрес и сразу получает код на почту.
  async createSession(rawEmail: string): Promise<EmailSessionCreated> {
    const email = normalizeEmail(rawEmail);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    const test = this.testLogin;
    if (test && email === test.email) {
      return this.createTestSession(test, expiresAt);
    }

    await this.assertNotFlooding(email);
    return this.createAndSend(email, null, expiresAt);
  }

  // Шаг 1 (привязка): текущий юзер хочет привязать/сменить почту. 409 сразу,
  // если адрес занят другой учёткой — не дожидаясь письма с кодом.
  async createLinkSession(
    userId: string,
    rawEmail: string,
  ): Promise<EmailSessionCreated> {
    const current = await this.users.findById(userId);
    if (current && isTestAccount(current.email, this.config)) {
      // Иначе тестовый аккаунт мог бы сам себе сменить email и перестать быть
      // тестовым — следующий вход по TEST_LOGIN_EMAIL завёл бы новую учётку.
      throw new ForbiddenException('Тестовый аккаунт нельзя редактировать');
    }

    const email = normalizeEmail(rawEmail);
    const existing = await this.users.findByEmail(email);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Этот email уже привязан к другому аккаунту');
    }

    await this.assertNotFlooding(email);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    return this.createAndSend(email, userId, expiresAt);
  }

  // Шаг 2 (вход): мобилка присылает код. Токены выдаются ровно один раз.
  async verify(nonce: string, code: string): Promise<TokenPair> {
    const session = await this.claim(nonce, code);
    const user = await this.resolveUser(session);
    return this.auth.issueTokens(user.id);
  }

  // Шаг 2 (привязка): код верный — переносим email на текущего юзера.
  async verifyLink(userId: string, nonce: string, code: string): Promise<User> {
    const session = await this.claim(nonce, code);
    if (session.userId !== userId) {
      throw new UnauthorizedException(
        'Сессия входа не принадлежит этому аккаунту',
      );
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { email: session.email, emailVerifiedAt: new Date() },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Этот email уже привязан к другому аккаунту',
        );
      }
      throw e;
    }
  }

  /**
   * Общая часть verify/verifyLink: протухание/попытки/код → однократный claim.
   * Тот же приём, что в TelegramAuthService.poll — гонка двух запросов не должна
   * выдать два успешных verify на одну сессию.
   */
  private async claim(nonce: string, code: string) {
    const session = await this.prisma.emailAuthSession.findUnique({
      where: { nonce },
    });
    if (!session || session.consumedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Сессия входа устарела, начните заново');
    }
    if (session.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException('Слишком много попыток, начните заново');
    }

    if (!safeEqual(hash(code), session.codeHash)) {
      const { attempts } = await this.prisma.emailAuthSession.update({
        where: { id: session.id },
        data: { attempts: { increment: 1 } },
      });
      if (attempts >= MAX_ATTEMPTS) {
        await this.prisma.emailAuthSession.update({
          where: { id: session.id },
          data: { consumedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Неверный код');
    }

    const claimed = await this.prisma.emailAuthSession.updateMany({
      where: { id: session.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException('Сессия входа уже использована');
    }

    return session;
  }

  /**
   * Кому выдаём токены. Политика мягче телефонной, потому что якорь ровно один
   * (адрес): легаси-юзеры с непроверенным email пускаются наравне с новыми —
   * владение ящиком только что доказал пришедший код.
   */
  private async resolveUser(session: {
    userId: string | null;
    email: string;
  }): Promise<User> {
    if (session.userId) {
      const user = await this.users.findById(session.userId);
      if (!user) throw new UnauthorizedException('Пользователь не найден');
      return user;
    }

    try {
      const existing = await this.users.findByEmail(session.email);
      if (existing) {
        if (existing.emailVerifiedAt === null) {
          return await this.prisma.user.update({
            where: { id: existing.id },
            data: { emailVerifiedAt: new Date() },
          });
        }
        return existing;
      }

      return await this.users.createFromEmailLogin({ email: session.email });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Бэкстоп на гонку: между чтением и записью email кто-то занял.
        throw new ConflictException(
          'Этот email уже привязан к другому аккаунту',
        );
      }
      throw e;
    }
  }

  /**
   * Тестовый аккаунт Play Store: письмо не отправляется, код известен заранее,
   * анти-флуд не применяется. Юзера заводим лениво (сид содержит только супер-админа).
   */
  private async createTestSession(
    test: { email: string; otp: string },
    expiresAt: Date,
  ): Promise<EmailSessionCreated> {
    let user = await this.users.findByEmail(test.email);
    user ??= await this.users.createFromEmailLogin({
      email: test.email,
      name: 'Test Account',
      role: Role.CUSTOMER,
    });

    const nonce = randomBytes(24).toString('base64url');
    await this.prisma.emailAuthSession.create({
      data: {
        nonce,
        email: test.email,
        codeHash: hash(test.otp),
        userId: user.id,
        expiresAt,
      },
    });
    this.logger.log(`Тестовый вход по почте ${test.email}`);

    return { nonce, expiresIn: this.ttlSeconds };
  }

  // Генерирует код, пишет сессию и отправляет письмо. Провал отправки гасит
  // сессию сразу: висящая сессия без кода бесполезна.
  private async createAndSend(
    email: string,
    userId: string | null,
    expiresAt: Date,
  ): Promise<EmailSessionCreated> {
    if (!this.mail.enabled) {
      throw new BadRequestException('Вход по почте не сконфигурирован');
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const nonce = randomBytes(24).toString('base64url');
    const session = await this.prisma.emailAuthSession.create({
      data: { nonce, email, codeHash: hash(code), userId, expiresAt },
    });

    try {
      await this.mail.sendLoginCode(email, code);
    } catch (e) {
      await this.prisma.emailAuthSession.update({
        where: { id: session.id },
        data: { consumedAt: new Date() },
      });
      this.logger.error(`Не удалось отправить код на ${email}: ${String(e)}`);
      throw new HttpException(
        'Не удалось отправить письмо',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { nonce, expiresIn: this.ttlSeconds };
  }

  /** Примитивный анти-флуд по адресу: throttler в проекте нет. */
  private async assertNotFlooding(email: string): Promise<void> {
    const recent = await this.prisma.emailAuthSession.count({
      where: {
        email,
        createdAt: { gt: new Date(Date.now() - RATE_WINDOW_MS) },
      },
    });
    if (recent >= MAX_SESSIONS_PER_WINDOW) {
      this.logger.warn(`Слишком частые попытки входа по почте ${email}`);
      throw new HttpException(
        'Слишком много попыток входа. Попробуйте позже.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
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
