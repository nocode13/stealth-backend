import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CategoriesService } from '../categories/categories.service';
import { FindCategoriesQueryDto } from '../categories/dto/category.dto';

// Список категорий для витрины (только одобренные — master и продавцов).
@ApiTags('mobile/categories')
@ApiBearerAuth()
@Controller('mobile/categories')
@UseGuards(JwtAuthGuard)
export class MobileCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Категории (витрина)' })
  findAll(@Query() query: FindCategoriesQueryDto) {
    return this.categories.findStorefront(query);
  }
}
