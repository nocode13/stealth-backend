import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Express } from 'express';
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
import { imageUploadBody, imageUploadOptions } from './upload.options';

// Категории: SUPER_ADMIN управляет master-деревом (категории товаров и подкатегории),
// SELLER может предложить свою подкатегорию (уходит в PENDING до апрува) и
// пользоваться ей наряду с master. Категорию верхнего уровня продавец не создаёт.
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
      'Создать категорию товаров (без parentId, только SUPER_ADMIN) или подкатегорию (SUPER_ADMIN — сразу master, SELLER — на ревью)',
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

  @Post(':id/icon')
  @Roles(Role.SUPER_ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Загрузить иконку категории товаров (только верхний уровень)',
  })
  @ApiBody(imageUploadBody)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  uploadIcon(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.categories.uploadIcon(id, file.buffer);
  }
}
