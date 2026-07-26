import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  MarkNotificationsReadDto,
  PollNotificationsDto,
} from '../notifications/dto/notification.dto';
import { NotificationsService } from '../notifications/notifications.service';

// Лента уведомлений мобилки: целиком под JWT, как MobileCartController —
// уведомления всегда персональные, гостевого доступа нет.
@ApiTags('mobile/notifications')
@ApiBearerAuth()
@Controller('mobile/notifications')
@UseGuards(JwtAuthGuard)
export class MobileNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
}
