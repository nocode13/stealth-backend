import { Controller, Get, Param, Query, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { CategoriesService } from '../categories/categories.service';
import { FindCategoriesQueryDto } from '../categories/dto/category.dto';
import { ReqLocale } from '../common/decorators/locale.decorator';
import {
  ApiVer,
  MOBILE_API_VERSIONS,
} from '../common/decorators/api-version.decorator';
import type { ApiVersion } from '../common/decorators/api-version.decorator';

// Категории для витрины (только одобренные — master и продавцов).
// Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/categories')
@Controller({ path: 'mobile/categories', version: MOBILE_API_VERSIONS })
export class MobileCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Без parentId — категории товаров (плитки главной, по position), с parentId — его подкатегории (по имени). v1 — плоский список родов',
  })
  findAll(
    @Query() query: FindCategoriesQueryDto,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    return ver === 2
      ? this.categories.findStorefront(query, locale)
      : this.categories.findStorefrontLegacy(query, locale);
  }

  @Get(':code')
  @Version('2')
  @ApiOperation({ summary: 'Категория товаров по code (экран категории)' })
  findOne(@Param('code') code: string, @ReqLocale() locale: Locale) {
    return this.categories.findOneStorefront(code, locale);
  }
}
