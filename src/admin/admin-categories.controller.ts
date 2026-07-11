import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { CategoriesService } from '../categories/categories.service';
import {
  CreateCategoryDto,
  FindCategoriesQueryDto,
  UpdateCategoryDto,
  UpdateCategoryStatusDto,
} from '../categories/dto/category.dto';

// Категории: SUPER_ADMIN управляет master-списком, SELLER может предложить
// свою (уходит в PENDING до апрува) и пользоваться ей наряду с master.
@ApiTags('admin/categories')
@ApiCookieAuth()
@Controller('admin/categories')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.SELLER)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Видимые категории (master + свои для продавца)' })
  findAll(
    @Query() query: FindCategoriesQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.findVisibleFor(user, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Создать категорию (SUPER_ADMIN — сразу master, SELLER — на ревью)',
  })
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.categories.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Апрув/реджект предложенной категории' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCategoryStatusDto) {
    return this.categories.updateStatus(id, dto.status);
  }
}
