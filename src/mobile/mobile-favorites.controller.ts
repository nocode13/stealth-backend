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
import {
  ApiVer,
  MOBILE_API_VERSIONS,
} from '../common/decorators/api-version.decorator';
import type { ApiVersion } from '../common/decorators/api-version.decorator';
import { toLegacyListing } from '../listings/mobile-listing';

// Избранное мобилки: целиком под JWT — гостевого избранного нет.
@ApiTags('mobile/favorites')
@ApiBearerAuth()
@Controller({ path: 'mobile/favorites', version: MOBILE_API_VERSIONS })
@UseGuards(JwtAuthGuard)
export class MobileFavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Избранные листинги текущего пользователя' })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: CursorPaginationDto,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    const page = await this.favorites.list(userId, query, locale);
    // v1: `category` — род (см. toLegacyListing).
    return ver === 2
      ? page
      : { ...page, items: page.items.map(toLegacyListing) };
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
