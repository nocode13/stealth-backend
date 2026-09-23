import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { BroadcastsService } from '../broadcasts/broadcasts.service';
import {
  BroadcastAudienceDto,
  CreateBroadcastDto,
  FindBroadcastsQueryDto,
} from '../broadcasts/dto/broadcast.dto';

// Рассылки пишут всем покупателям сразу — только SUPER_ADMIN.
@ApiTags('admin/broadcasts')
@ApiCookieAuth()
@Controller('admin/broadcasts')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminBroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  @ApiOperation({ summary: 'История рассылок (cursor-пагинация)' })
  findAll(@Query() query: FindBroadcastsQueryDto) {
    return this.broadcasts.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Рассылка со счётчиками доставки' })
  findOne(@Param('id') id: string) {
    return this.broadcasts.findOne(id);
  }

  @Post('audience-count')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Сколько покупателей получит рассылку',
    description:
      'total — строк в ленте, withPush / withTelegram — достижимы по каналу.',
  })
  audienceCount(@Body() dto: BroadcastAudienceDto) {
    return this.broadcasts.countAudience(dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать и отправить рассылку',
    description:
      'Лента пишется сразу, push и Telegram доставляются в фоне — статус SENDING, ' +
      'прогресс виден по счётчикам в GET /admin/broadcasts/:id.',
  })
  create(@Body() dto: CreateBroadcastDto, @CurrentUser() user: AuthUser) {
    return this.broadcasts.create(dto, user.id);
  }
}
