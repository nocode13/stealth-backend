import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  phone: string;
  email: string | null;
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

  // Возвращённое значение попадает в request.user.
  validate(payload: JwtPayload): AuthUser {
    return {
      id: payload.sub,
      phone: payload.phone,
      email: payload.email,
      role: payload.role,
      sellerId: payload.sellerId,
    };
  }
}
