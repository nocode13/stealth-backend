import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Приводит запись User к безопасному виду, который кладём в request/сессию.
  toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      telegramId: user.telegramId,
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
      sellerId: user.sellerId,
    };
  }

  // Используется LocalStrategy (админка) и mobile login.
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthUser> {
    const user = await this.users.findByEmail(email);
    if (!user || !(await this.users.verifyPassword(user, password))) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    return this.toAuthUser(user);
  }

  // Вход мобилки: find-or-create по telegramId, дальше обычные токены.
  // Профиль (phone/email) не трогаем — юзер заполняет его сам в настройках.
  async loginWithTelegram(tg: {
    telegramId: string;
    name?: string | null;
  }): Promise<TokenPair> {
    let user = await this.users.findByTelegramId(tg.telegramId);
    user ??= await this.users.createFromTelegram(tg);
    return this.issueTokens(user.id);
  }

  // Выпускает пару access+refresh и сохраняет хэш refresh-токена в БД.
  async issueTokens(userId: string): Promise<TokenPair> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();

    // Payload узкий: только то, что нужно гвардам. Профильные поля (phone/email/
    // name) редактируемые, поэтому их отдаёт GET /mobile/auth/me из БД, а не JWT.
    const payload = {
      sub: user.id,
      role: user.role,
      sellerId: user.sellerId,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>(
        'jwt.accessExpiresIn',
      ) as unknown as number,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() }, // jti гарантирует уникальность токена
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>(
          'jwt.refreshExpiresIn',
        ) as unknown as number,
      },
    );

    await this.persistRefreshToken(user.id, refreshToken);
    return { accessToken, refreshToken };
  }

  // Проверяет refresh-токен, ротирует его (revoke старый, выпускает новый).
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Невалидный refresh-токен');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!stored) {
      throw new UnauthorizedException('Refresh-токен отозван или истёк');
    }

    // Ротация: гасим использованный токен и выпускаем новую пару.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(payload.sub);
  }

  // Разлогин мобилки: гасим конкретный refresh-токен.
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async persistRefreshToken(
    userId: string,
    token: string,
  ): Promise<void> {
    const decoded = this.jwt.decode<{ exp: number }>(token);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
