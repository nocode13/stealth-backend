import {
  Body,
  Controller,
  Delete,
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
  ApiCookieAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Express } from 'express';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CatalogService } from '../catalog/catalog.service';
import {
  assertMediaFile,
  imageUploadBody,
  mediaUploadOptions,
} from './upload.options';
import {
  CreateCatalogItemDto,
  FindCatalogQueryDto,
  ReorderCatalogMediaDto,
  UpdateCatalogItemDto,
} from '../catalog/dto/catalog.dto';

// Справочник: SUPER_ADMIN управляет master-списком, SELLER может предложить
// свою позицию (уходит в PENDING до апрува) и видит/использует её только сам.
@ApiTags('admin/catalog')
@ApiCookieAuth()
@Controller('admin/catalog')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.SELLER)
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Видимый справочник (master + свои для продавца)' })
  findAll(@Query() query: FindCatalogQueryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.findVisibleFor(user, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalog.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Добавить позицию (SUPER_ADMIN — сразу master, SELLER — на ревью)',
  })
  create(@Body() dto: CreateCatalogItemDto, @CurrentUser() user: AuthUser) {
    return this.catalog.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Обновить позицию (поле status — только SUPER_ADMIN, апрув/реджект)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.update(id, dto, user);
  }

  @Post(':id/media')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Добавить фото или видео в галерею позиции (видео уходит в фоновую обработку)',
  })
  @ApiBody(imageUploadBody)
  @UseInterceptors(FileInterceptor('file', mediaUploadOptions))
  addMedia(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    assertMediaFile(file);
    return this.catalog.addMedia(id, file, user);
  }

  @Delete(':id/media/:mediaId')
  @ApiOperation({ summary: 'Удалить медиафайл из галереи позиции справочника' })
  removeMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.removeMedia(id, mediaId, user);
  }

  @Patch(':id/media/:mediaId/reorder')
  @ApiOperation({ summary: 'Сдвинуть медиафайл в галерее вверх/вниз' })
  reorderMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() dto: ReorderCatalogMediaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.reorderMedia(id, mediaId, dto.direction, user);
  }
}
