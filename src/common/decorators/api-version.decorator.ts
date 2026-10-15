import {
  createParamDecorator,
  ExecutionContext,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Версии мобильного API. v1 — пути без префикса (`/mobile/...`), заморожены под уже
 * установленные сборки; v2 — `/v2/mobile/...`, текущая мобилка. Контроллер mobile/
 * регистрируется сразу на обе: `@Controller({ path, version: MOBILE_API_VERSIONS })`.
 * Эндпоинт, которого в v1 не было, — `@Version('2')` на хендлере.
 */
// Тип явно: без него TS расширяет элементы до `string | symbol`, а `@Controller` ждёт
// именно `typeof VERSION_NEUTRAL` (`VersionValue` из корня @nestjs/common не экспортится).
export const MOBILE_API_VERSIONS: Array<string | typeof VERSION_NEUTRAL> = [
  VERSION_NEUTRAL,
  '2',
];

export type ApiVersion = 1 | 2;

/** Версия API запроса по префиксу пути: `/v2/...` → 2, иначе 1. */
export const ApiVer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiVersion =>
    ctx.switchToHttp().getRequest<Request>().path.startsWith('/v2/') ? 2 : 1,
);
