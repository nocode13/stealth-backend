import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { CategoriesService } from '../categories/categories.service';
import { FindCategoriesQueryDto } from '../categories/dto/category.dto';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Список категорий для витрины (только одобренные — master и продавцов).
// Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/categories')
@Controller('mobile/categories')
export class MobileCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Категории (витрина)' })
  findAll(@Query() query: FindCategoriesQueryDto, @ReqLocale() locale: Locale) {
    return this.categories.findStorefront(query, locale);
  }
}
