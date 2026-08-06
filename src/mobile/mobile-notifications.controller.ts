import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  MarkNotificationsReadDto,
  PollNotificationsDto,
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
} from '../notifications/dto/notification.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PushTokensService } from '../push/push-tokens.service';

// Лента уведомлений мобилки: целиком под JWT, как MobileCartController —
// уведомления всегда персональные, гостевого доступа нет.
@ApiTags('mobile/notifications')
@ApiBearerAuth()
@Controller('mobile/notifications')
@UseGuards(JwtAuthGuard)
export class MobileNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly pushTokens: PushTokensService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Новые уведомления после курсора (поллинг)',
    description:
      'Клиент опрашивает эндпоинт и по новым записям обновляет UI. Без `after` ' +
      'отдаётся бутстрап — последние записи, которые клиент показывает как ' +
      'прочитанную ленту. `cursor` возвращается всегда, в том числе при пустом `items`.',
  })
  poll(
    @CurrentUser('id') userId: string,
    @Query() query: PollNotificationsDto,
  ) {
    return this.notifications.page(userId, query.after, query.limit);
  }

  @Post('read')
  @ApiOperation({
    summary: 'Пометить уведомления прочитанными (без ids — все)',
  })
  markRead(
    @CurrentUser('id') userId: string,
    @Body() dto: MarkNotificationsReadDto,
  ) {
    return this.notifications.markRead(userId, dto.ids);
  }

  @Post('push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Зарегистрировать push-токен установки',
    description:
      'Токен привязывается к текущему пользователю. Повторный вызов с тем же ' +
      'токеном переносит его на нового владельца — токен принадлежит устройству, ' +
      'а не человеку.',
  })
  async registerPushToken(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterPushTokenDto,
  ) {
    await this.pushTokens.register(userId, dto.token, dto.platform);
  }

  @Delete('push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Снять push-токен (выход из аккаунта)',
    description:
      'Удаляется только переданный токен: выход на одном устройстве не должен ' +
      'гасить пуши на остальных.',
  })
  async unregisterPushToken(@Body() dto: UnregisterPushTokenDto) {
    await this.pushTokens.unregister(dto.token);
  }
}
