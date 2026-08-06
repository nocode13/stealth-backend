import { Injectable } from '@nestjs/common';
import { PushToken } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Реестр push-токенов установок приложения.
 *
 * Токен принадлежит УСТАНОВКЕ, а не человеку, поэтому upsert идёт по самому
 * токену: вошёл другой юзер на том же устройстве — строка переезжает к нему,
 * иначе пуши продолжали бы уходить прошлому владельцу аккаунта.
 */
@Injectable()
export class PushTokensService {
  constructor(private readonly prisma: PrismaService) {}

  register(
    userId: string,
    token: string,
    platform: string,
  ): Promise<PushToken> {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });
  }

  // Снятие токена при логауте. По токену, а не по юзеру: выходим из аккаунта на
  // одном устройстве, а на остальных пуши должны остаться.
  async unregister(token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }

  listFor(userId: string): Promise<PushToken[]> {
    return this.prisma.pushToken.findMany({ where: { userId } });
  }
}
