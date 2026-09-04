import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Locale, OrderStatus, Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/phone';
import { isTestAccount } from '../common/test-account';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';
import { isTerminal } from '../orders/order-status';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Поиск по «личностным» колонкам идёт через findFirst с `deletedAt: null`, а не
  // findUnique: удалённый аккаунт свои phone/email/telegramId обнуляет, но если
  // когда-нибудь останется хвост, вход по нему не должен воскресить учётку —
  // повторная регистрация обязана создать новую (см. deleteAccount).
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { telegramId, deletedAt: null },
    });
  }

  // По id — без фильтра: id приходит из уже выпущенного токена, и вызывающему
  // (JwtStrategy) нужно отличить «нет такого» от «аккаунт удалён».
  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // Заведение рабочего аккаунта из админки (сотрудник продавца).
  // Пароль опционален: без него в админку не войти (verifyPassword вернёт false),
  // но кабинет в боте продавца работает — это валидный сценарий «только бот».
  async create(data: {
    phone?: string;
    email?: string;
    name?: string;
    password?: string;
    role?: Role;
    sellerId?: string;
  }): Promise<User> {
    const passwordHash = data.password
      ? await bcrypt.hash(data.password, 10)
      : null;
    return this.prisma.user.create({
      data: {
        phone: data.phone,
        email: data.email,
        name: data.name,
        passwordHash,
        role: data.role ?? Role.CUSTOMER,
        sellerId: data.sellerId,
      },
    });
  }

  // Регистрация мобилки: всё, что мы знаем о новом юзере, — его telegramId
  // и имя из Telegram. Телефон/email он заполнит сам в профиле.
  createFromTelegram(data: {
    telegramId: string;
    name?: string | null;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        telegramId: data.telegramId,
        name: data.name ?? null,
        role: Role.CUSTOMER,
      },
    });
  }

  // Регистрация по коду на почту: адрес уже подтверждён (код только что пришёл
  // именно на него, либо это тестовый аккаунт), поэтому emailVerifiedAt
  // проставляется сразу — второго подтверждения тому же адресу не нужно.
  createFromEmailLogin(data: {
    email: string;
    name?: string | null;
    role?: Role;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        emailVerifiedAt: new Date(),
        name: data.name ?? null,
        role: data.role ?? Role.CUSTOMER,
      },
    });
  }

  // Дозаполнение профиля. Оба поля опциональны; пустая строка = очистить поле
  // (иначе уникальный индекс не даст второму юзеру сохранить тот же "").
  // Email сюда не входит вовсе — это якорь входа, и правится он только через
  // подтверждение кодом (EmailAuthService.createLinkSession/verifyLink).
  //
  // Тестовый аккаунт Play Store правку профиля не получает вовсе: он опознаётся по
  // адресу почты, а этот метод email не трогает, так что «испортить» тестовость
  // отсюда нельзя — проверка тем не менее здесь, а не в контроллере, чтобы её
  // нельзя было обойти в обход этого метода.
  //
  // ⚠️ Телефон заполняется ОДИН раз и дальше неизменяем. Он уже уехал в снапшоты
  // заказов и служит контактом для курьера, а подтверждения номера в этом эндпоинте
  // нет — значит через PATCH юзер занял бы чужой номер. Пустой phone дозаполнить
  // можно — это и есть тот самый единственный раз.
  async updateProfile(
    userId: string,
    data: { name?: string; phone?: string },
  ): Promise<User> {
    const current = await this.findById(userId);
    if (!current) throw new NotFoundException(err(ERRORS.USER_NOT_FOUND));
    if (isTestAccount(current.email, this.config)) {
      throw new ForbiddenException(err(ERRORS.TEST_ACCOUNT_READONLY));
    }

    const normalize = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() === '' ? null : v.trim();

    // Прислать текущий номер не ошибка (клиент шлёт форму целиком) — сверяем по
    // нормализованному виду, потому что в профиле он лежит как `+998…`.
    const phone = normalize(data.phone);
    if (current.phone !== null && phone !== undefined) {
      const same =
        phone !== null &&
        normalizePhone(phone) === normalizePhone(current.phone);
      if (!same) {
        throw new ForbiddenException(err(ERRORS.PHONE_IMMUTABLE));
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: normalize(data.name),
          // Номер уже есть → выше доказано, что он тот же; не переписываем, чтобы
          // не испортить нормализованное значение форматированием с клиента.
          phone: current.phone === null ? phone : undefined,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Единственное уникальное поле в этом апдейте — phone (name не unique).
        throw new ConflictException(err(ERRORS.PHONE_TAKEN));
      }
      throw e;
    }
  }

  /** Язык уведомлений (пуши/Telegram-DM) — они уходят вне HTTP-запроса, заголовка там нет. */
  async setLocale(userId: string, locale: Locale): Promise<void> {
    await this.prisma.user.updateMany({
      // ⚠️ Одного `locale: { not: locale }` тут НЕ хватает: колонка nullable, и Prisma
      // компилирует такой фильтр в голое `locale <> $1`, под которое NULL не попадает.
      // А NULL — ровно то, что стоит у юзера до первой синхронизации языка, поэтому
      // первая (и единственно важная) запись молча матчила 0 строк, updateMany не
      // бросал, эндпоинт отвечал 204, а уведомления навсегда оставались на RU.
      where: { id: userId, OR: [{ locale: null }, { locale: { not: locale } }] },
      data: { locale },
    });
  }

  // Удаление аккаунта покупателя (требование Google Play: приложение с регистрацией
  // обязано уметь удалять учётку изнутри).
  //
  // Строку users НЕ удаляем: Order.userId стоит onDelete: Restrict, и это намеренно —
  // заказы обязаны пережить уход покупателя ради отчётности продавца. Вместо этого
  // затираем персональный снапшот в заказах и обнуляем профиль. phone/email/telegramId
  // nullable+unique, поэтому обнуление освобождает их: вход по тому же номеру заведёт
  // НОВУЮ учётку (findByPhone фильтрует по deletedAt: null).
  //
  // Активные заказы блокируют удаление: без телефона и адреса курьер не доедет.
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException(err(ERRORS.USER_NOT_FOUND));
    if (user.deletedAt) return; // идемпотентно: повтор не ошибка
    if (isTestAccount(user.email, this.config)) {
      throw new ForbiddenException(err(ERRORS.TEST_ACCOUNT_NO_DELETE));
    }

    // Список нетерминальных статусов выводим из ALLOWED_TRANSITIONS, а не
    // перечисляем руками — AGENTS.md запрещает вторую копию карты переходов.
    const activeStatuses = Object.values(OrderStatus).filter(
      (s) => !isTerminal(s),
    );
    const active = await this.prisma.order.count({
      where: { userId, status: { in: activeStatuses } },
    });
    if (active > 0) {
      throw new ConflictException(err(ERRORS.ACTIVE_ORDERS_BLOCK_DELETE));
    }

    await this.prisma.$transaction([
      this.prisma.savedAddress.deleteMany({ where: { userId } }),
      this.prisma.cartItem.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.pushToken.deleteMany({ where: { userId } }),
      // Незавершённые сессии входа: в них лежит email/telegramId, и живая
      // сессия после удаления восстановила бы привязку к этой же строке.
      this.prisma.telegramAuthSession.deleteMany({ where: { userId } }),
      this.prisma.botLinkSession.deleteMany({ where: { userId } }),
      this.prisma.emailAuthSession.deleteMany({
        where: user.email
          ? { OR: [{ userId }, { email: user.email }] }
          : { userId },
      }),
      // Заказы остаются, но обезличенными: суммы и позиции нужны для отчётности,
      // контакты и точка на карте — уже нет. Снапшот живёт в OrderGroup, а не в
      // Order, поэтому обезличивается группа.
      this.prisma.orderGroup.updateMany({
        where: { userId },
        data: {
          contactName: 'Удалённый пользователь',
          contactPhone: '',
          deliveryAddress: '',
          deliveryComment: null,
          deliveryLat: null,
          deliveryLng: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          telegramId: null,
          staffTelegramId: null,
          phone: null,
          email: null,
          emailVerifiedAt: null,
          name: null,
          passwordHash: null,
          deletedAt: new Date(),
        },
      }),
    ]);
  }

  verifyPassword(user: User, password: string): Promise<boolean> {
    // У пользователей мобилки (вход через Telegram) пароля нет.
    if (!user.passwordHash) return Promise.resolve(false);
    return bcrypt.compare(password, user.passwordHash);
  }
}
