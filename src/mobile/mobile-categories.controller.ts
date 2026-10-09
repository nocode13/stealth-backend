import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { CategoriesService } from '../categories/categories.service';
import { FindCategoriesQueryDto } from '../categories/dto/category.dto';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Категории для витрины (только одобренные — master и продавцов).
// Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/categories')
@Controller('mobile/categories')
export class MobileCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Без parentId — категории товаров (плитки главной, по position), с parentId — его подкатегории (по имени)',
  })
  findAll(@Query() query: FindCategoriesQueryDto, @ReqLocale() locale: Locale) {
    return this.categories.findStorefront(query, locale);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Категория товаров по code (экран категории)' })
  findOne(@Param('code') code: string, @ReqLocale() locale: Locale) {
    return this.categories.findOneStorefront(code, locale);
  }
}
