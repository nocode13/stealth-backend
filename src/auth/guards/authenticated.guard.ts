import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

// Защита роутов админки: проверяет активную passport-сессию (httpOnly cookie).
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.isAuthenticated()) {
      throw new UnauthorizedException('Требуется вход');
    }
    return true;
  }
}
