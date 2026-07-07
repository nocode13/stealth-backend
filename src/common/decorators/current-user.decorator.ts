import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  phone: string;
  email: string | null;
  role: import('@prisma/client').Role;
  sellerId: string | null;
}

// Достаёт аутентифицированного пользователя из request (кладут стратегии/сессия).
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUser | undefined;
    return data ? user?.[data] : user;
  },
);
