import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { AuthPrincipal } from '../../common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  role: Role;
  sellerId: string | null;
}

// Стратегия для мобилки: Bearer access-token.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret')!,
    });
  }

  // Возвращённое значение попадает в request.user. Профильных полей тут нет
  // намеренно — они редактируемые, читаются из БД в /mobile/auth/me.
  validate(payload: JwtPayload): AuthPrincipal {
    return {
      id: payload.sub,
      role: payload.role,
      sellerId: payload.sellerId,
    };
  }
}
