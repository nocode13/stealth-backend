import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpChannel, Role, User } from '@prisma/client';
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
      phone: user.phone,
      email: user.email,
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

  // Регистрация покупателя из мобилки (по паролю; phone обязателен).
  async registerCustomer(
    phone: string,
    password: string,
    email?: string,
  ): Promise<TokenPair> {
    const existing = await this.users.findByPhone(phone);
    if (existing) {
      throw new UnauthorizedException(
        'Пользователь с таким телефоном уже существует',
      );
    }
    const user = await this.users.create({
      phone,
      email,
      password,
      role: Role.CUSTOMER,
    });
    return this.issueTokens(user.id);
  }

  // Passwordless-вход по OTP: find-or-create по телефону, привязка контакта, токены.
  async loginWithOtp(
    phone: string,
    channel: OtpChannel,
    destination: string,
  ): Promise<TokenPair> {
    let user = await this.users.findByPhone(phone);
    user ??= await this.users.createFromPhone(phone);
    // Если код пришёл через email/telegram — привязываем контакт к юзеру.
    if (channel !== OtpChannel.SMS) {
      await this.users.linkContact(user.id, channel, destination);
    }
    return this.issueTokens(user.id);
  }

  // Выпускает пару access+refresh и сохраняет хэш refresh-токена в БД.
  async issueTokens(userId: string): Promise<TokenPair> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();

    const payload = {
      sub: user.id,
      phone: user.phone,
      email: user.email,
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
