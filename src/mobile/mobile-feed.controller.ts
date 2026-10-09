import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { FeedService } from '../feed/feed.service';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Лента главной мобилки. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/feed')
@Controller('mobile/feed')
export class MobileFeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  @ApiOperation({
    summary:
      'Лента главной: порядок решает бэкенд; элементы — конверты { type, id, ... }',
  })
  findAll(@Query() query: CursorPaginationDto, @ReqLocale() locale: Locale) {
    return this.feed.findFeed(query, locale);
  }
}
