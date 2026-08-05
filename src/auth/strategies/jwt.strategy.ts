import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { AuthPrincipal } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  role: Role;
  sellerId: string | null;
}

// Стратегия для мобилки: Bearer access-token.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret')!,
    });
  }

  // Возвращённое значение попадает в request.user. Профильных полей тут нет
  // намеренно — они редактируемые, читаются из БД в /mobile/auth/me.
  //
  // Один запрос в БД на каждый авторизованный вызов — плата за удаление аккаунта:
  // refresh-токены при удалении гасятся, но уже выданный access живёт до конца
  // своего TTL, и всё это время удалённая учётка оставалась бы рабочей. Запрос
  // идёт по первичному ключу и выбирает одну колонку.
  async validate(payload: JwtPayload): Promise<AuthPrincipal> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Аккаунт удалён');
    }
    return {
      id: payload.sub,
      role: payload.role,
      sellerId: payload.sellerId,
    };
  }
}
