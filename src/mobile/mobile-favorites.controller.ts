import {
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { FavoritesService } from '../favorites/favorites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqLocale } from '../common/decorators/locale.decorator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';

// Избранное мобилки: целиком под JWT — гостевого избранного нет.
@ApiTags('mobile/favorites')
@ApiBearerAuth()
@Controller('mobile/favorites')
@UseGuards(JwtAuthGuard)
export class MobileFavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Избранные листинги текущего пользователя' })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: CursorPaginationDto,
    @ReqLocale() locale: Locale,
  ) {
    return this.favorites.list(userId, query, locale);
  }

  @Get('ids')
  @ApiOperation({
    summary: 'id листингов в избранном — под heart-состояние на клиенте',
  })
  async listIds(@CurrentUser('id') userId: string) {
    const listingIds = await this.favorites.listIds(userId);
    return { listingIds };
  }

  @Put(':listingId')
  @ApiOperation({ summary: 'Добавить листинг в избранное' })
  add(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.favorites.add(userId, listingId);
  }

  @Delete(':listingId')
  @ApiOperation({ summary: 'Убрать листинг из избранного' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.favorites.remove(userId, listingId);
  }
}
