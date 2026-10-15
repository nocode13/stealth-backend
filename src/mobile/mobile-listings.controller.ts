import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { ListingsService } from '../listings/listings.service';
import { FindListingsQueryDto } from '../listings/dto/listing.dto';
import { toLegacyListing } from '../listings/mobile-listing';
import { ReqLocale } from '../common/decorators/locale.decorator';
import {
  ApiVer,
  MOBILE_API_VERSIONS,
} from '../common/decorators/api-version.decorator';
import type { ApiVersion } from '../common/decorators/api-version.decorator';

// Витрина мобилки: активные листинги с остатком. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/listings')
@Controller({ path: 'mobile/listings', version: MOBILE_API_VERSIONS })
export class MobileListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Активные предложения (витрина)' })
  async findAll(
    @Query() query: FindListingsQueryDto,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    if (ver === 2) return this.listings.findStorefront(query, locale);

    // v1: categoryId — id рода, а род после миграции category_tree — подкатегория
    // (id сохранились).
    const page = await this.listings.findStorefront(
      {
        ...query,
        categoryId: undefined,
        subcategoryId: query.categoryId ?? query.subcategoryId,
      },
      locale,
    );
    return { ...page, items: page.items.map(toLegacyListing) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Одно активное предложение (карточка товара)',
    description: 'id — cuid листинга или его артикул (code)',
  })
  async findOne(
    @Param('id') id: string,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    const listing = await this.listings.findOnePublic(id, locale);
    return ver === 2 ? listing : toLegacyListing(listing);
  }
}
