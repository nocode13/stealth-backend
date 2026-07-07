import { Injectable } from '@nestjs/common';
import { OtpChannel, Prisma, Role, User } from '@prisma/client';
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

  // Passwordless-создание по телефону (OTP-вход нового пользователя).
  createFromPhone(phone: string): Promise<User> {
    return this.prisma.user.create({
      data: { phone, role: Role.CUSTOMER },
    });
  }

  // Привязывает контактный канал к пользователю после успешного OTP через него.
  // Пропускает привязку, если контакт уже занят другим пользователем.
  async linkContact(
    userId: string,
    channel: OtpChannel,
    destination: string,
  ): Promise<void> {
    const data: Prisma.UserUpdateInput =
      channel === OtpChannel.EMAIL
        ? { email: destination }
        : channel === OtpChannel.TELEGRAM
          ? { telegramId: destination }
          : {};
    if (Object.keys(data).length === 0) return;

    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch (e) {
      // Unique-конфликт: контакт уже привязан к другому юзеру — не критично для входа.
      if (!(
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      )) {
        throw e;
      }
    }
  }

  verifyPassword(user: User, password: string): Promise<boolean> {
    // У OTP-пользователей пароля нет.
    if (!user.passwordHash) return Promise.resolve(false);
    return bcrypt.compare(password, user.passwordHash);
  }
}
