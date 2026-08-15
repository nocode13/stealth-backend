import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/phone';
import { isTestAccount } from '../common/test-account';
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

  // Регистрация по номеру телефона: номер уже подтверждён (контакт из Telegram
  // либо тестовый аккаунт), поэтому кладём его сразу. telegramId null — только у
  // тестового аккаунта Play Store, у него шага с ботом нет.
  createFromPhoneLogin(data: {
    telegramId: string | null;
    phone: string;
    name?: string | null;
    role?: Role;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        telegramId: data.telegramId,
        phone: data.phone,
        name: data.name ?? null,
        role: data.role ?? Role.CUSTOMER,
      },
    });
  }

  // Дозаполнение профиля. Все поля опциональны; пустая строка = очистить поле
  // (иначе уникальный индекс не даст второму юзеру сохранить тот же "").
  //
  // Тестовый аккаунт Play Store правку профиля не получает вовсе: он опознаётся по
  // номеру, и смена телефона превратила бы его в обычного юзера, а следующий вход по
  // TEST_LOGIN_PHONE завёл бы новую учётку. Проверка здесь, а не в контроллере, —
  // чтобы её нельзя было обойти в обход этого метода.
  //
  // ⚠️ Телефон заполняется ОДИН раз и дальше неизменяем. Он уже уехал в снапшоты
  // заказов и служит контактом для курьера, а подтверждения номера в этом эндпоинте
  // нет (настоящий номер даёт только Telegram, см. PhoneAuthService) — значит через
  // PATCH юзер занял бы чужой номер или увёл бы у себя вход по номеру. Пустой phone
  // дозаполнить можно — это и есть тот самый единственный раз.
  async updateProfile(
    userId: string,
    data: { name?: string; phone?: string; email?: string },
  ): Promise<User> {
    const current = await this.findById(userId);
    if (!current) throw new NotFoundException('Пользователь не найден');
    if (isTestAccount(current.phone, this.config)) {
      throw new ForbiddenException('Тестовый аккаунт нельзя редактировать');
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
        throw new ForbiddenException('Номер телефона изменить нельзя');
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
          email: normalize(data.email),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // target — список полей, нарушивших unique-индекс.
        const target = (e.meta?.target as string[] | undefined) ?? [];
        const field = target.includes('phone')
          ? 'Этот телефон'
          : target.includes('email')
            ? 'Этот email'
            : 'Эти данные';
        throw new ConflictException(`${field} уже привязан к другому аккаунту`);
      }
      throw e;
    }
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
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.deletedAt) return; // идемпотентно: повтор не ошибка
    if (isTestAccount(user.phone, this.config)) {
      throw new ForbiddenException('Тестовый аккаунт нельзя удалить');
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
      throw new ConflictException(
        'Сначала завершите или отмените активные заказы',
      );
    }

    await this.prisma.$transaction([
      this.prisma.savedAddress.deleteMany({ where: { userId } }),
      this.prisma.cartItem.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.pushToken.deleteMany({ where: { userId } }),
      // Незавершённые сессии входа: в них лежит телефон/telegramId, и живая
      // сессия после удаления восстановила бы привязку к этой же строке.
      this.prisma.telegramAuthSession.deleteMany({ where: { userId } }),
      this.prisma.botLinkSession.deleteMany({ where: { userId } }),
      this.prisma.phoneAuthSession.deleteMany({
        where: user.phone
          ? { OR: [{ userId }, { phone: user.phone }] }
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
