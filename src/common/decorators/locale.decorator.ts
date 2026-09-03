import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Locale } from '@prisma/client';
import { parseAcceptLanguage } from '../../i18n/locale';

/**
 * Локаль запроса из Accept-Language. Ставится ТОЛЬКО в контроллерах mobile/:
 * админка всегда работает на DEFAULT_LOCALE (её браузер шлёт свой заголовок,
 * и без этого правила админ с англ. локалью видел бы английские названия).
 */
export const ReqLocale = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Locale =>
    parseAcceptLanguage(
      ctx.switchToHttp().getRequest<Request>().headers['accept-language'],
    ),
);
