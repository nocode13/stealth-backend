import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // Создание пользователя с паролем (phone обязателен — якорь личности).
  async create(data: {
    phone: string;
    email?: string;
    password: string;
    role?: Role;
    sellerId?: string;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: {
        phone: data.phone,
        email: data.email,
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

  // Дозаполнение профиля. Все поля опциональны; пустая строка = очистить поле
  // (иначе уникальный индекс не даст второму юзеру сохранить тот же "").
  async updateProfile(
    userId: string,
    data: { name?: string; phone?: string; email?: string },
  ): Promise<User> {
    const normalize = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() === '' ? null : v.trim();

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: normalize(data.name),
          phone: normalize(data.phone),
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

  verifyPassword(user: User, password: string): Promise<boolean> {
    // У пользователей мобилки (вход через Telegram) пароля нет.
    if (!user.passwordHash) return Promise.resolve(false);
    return bcrypt.compare(password, user.passwordHash);
  }
}
