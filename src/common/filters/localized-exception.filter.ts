import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isLocalizedErrorBody } from '../../i18n/api-error';
import { parseAcceptLanguage } from '../../i18n/locale';
import { translateError } from '../../i18n/messages';

// Первый глобальный фильтр в проекте: переводит только тела вида LocalizedErrorBody
// ({ messageKey, params? }), которые сервисы бросают через err(...) (src/i18n/api-error.ts).
// Всё остальное (обычные русские строки админских путей, массив сообщений ValidationPipe)
// проходит как есть — форма тела не меняется.
@Catch(HttpException)
export class LocalizedExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const locale = parseAcceptLanguage(request.headers['accept-language']);
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (isLocalizedErrorBody(body)) {
      const message =
        translateError(body.messageKey, locale, body.params) ?? body.messageKey;
      response.status(status).json({ statusCode: status, message });
      return;
    }
    response
      .status(status)
      .json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      );
  }
}
