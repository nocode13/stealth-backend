import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// То, что реально лежит в request.user: id + всё, что нужно гвардам.
// Ровно это кладёт JwtStrategy из claims access-токена.
export interface AuthPrincipal {
  id: string;
  role: import('@prisma/client').Role;
  sellerId: string | null;
}

// Полный профиль — ответ /me и то, что кладёт в сессию админка (читается из БД).
// telegramId — якорь личности мобилки; phone/email/name опциональны, пока юзер
// не заполнит их сам, поэтому в access-токене их НЕТ (они редактируемые).
export interface AuthUser extends AuthPrincipal {
  telegramId: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
}

// Достаёт аутентифицированного пользователя из request (кладут стратегии/сессия).
// ВНИМАНИЕ: на JWT-роутах (мобилка) здесь только поля AuthPrincipal — профильные
// phone/email/name читаются из БД, см. GET /mobile/auth/me.
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUser | undefined;
    return data ? user?.[data] : user;
  },
);
