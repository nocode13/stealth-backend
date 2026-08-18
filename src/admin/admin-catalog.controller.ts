import {
  BadRequestException,
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
import { MediaStatus, MediaType, Role } from '@prisma/client';
import type { Express } from 'express';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CatalogService } from '../catalog/catalog.service';
import type { CatalogItem } from '../catalog/catalog.service';
import { StorageService } from '../storage/storage.service';
import { ImageService } from '../storage/image.service';
import { MediaProcessingService } from '../storage/media-processing.service';
import {
  MAX_IMAGE_SIZE,
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
  constructor(
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
    private readonly mediaProcessing: MediaProcessingService,
  ) {}

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

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.remove(id, user);
  }

  @Post(':id/media')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Добавить фото или видео в галерею позиции (видео уходит в фоновую обработку)',
  })
  @ApiBody(imageUploadBody)
  @UseInterceptors(FileInterceptor('file', mediaUploadOptions))
  async addMedia(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return file.mimetype.startsWith('video/')
      ? this.addVideo(id, file, user)
      : this.addImage(id, file, user);
  }

  private async addImage(
    id: string,
    file: Express.Multer.File,
    user: AuthUser,
  ) {
    // Лимит multer на роуте общий (50 МБ, по видео), поэтому фото режем здесь.
    if (file.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException('Фото больше 5 МБ');
    }
    // Расширение и Content-Type берём из результата конвертации, а не из
    // originalname/mimetype — те приходят от клиента и ничем не подтверждены.
    const { buffer, contentType, ext } = await this.image.toWebp(file.buffer);
    const key = `catalog/${id}-${Date.now()}.${ext}`;
    await this.storage.upload(key, buffer, contentType);
    const { item } = await this.catalog.addMedia(
      id,
      { url: key, type: MediaType.IMAGE, status: MediaStatus.READY },
      user,
    );
    return item;
  }

  // Видео транскодится минутами, поэтому в запросе только заливка оригинала:
  // строка создаётся в PROCESSING (с временной ссылкой на оригинал), mp4 и обложку
  // дорисовывает MediaProcessingService, админка поллит позицию до READY.
  private async addVideo(
    id: string,
    file: Express.Multer.File,
    user: AuthUser,
  ) {
    const key = this.mediaProcessing.sourceKey(file.originalname);
    await this.storage.upload(key, file.buffer, file.mimetype);
    let created: { item: CatalogItem; mediaId: string };
    try {
      created = await this.catalog.addMedia(
        id,
        {
          url: key,
          type: MediaType.VIDEO,
          status: MediaStatus.PROCESSING,
        },
        user,
      );
    } catch (error) {
      // Чужая позиция или упёрлись в лимит галереи — оригинал в бакете не нужен.
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    this.mediaProcessing.enqueue(created.mediaId);
    return created.item;
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
