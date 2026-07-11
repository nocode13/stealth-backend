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
  ApiCookieAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role, ReviewStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';
import type { Express } from 'express';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CatalogService } from '../catalog/catalog.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateCatalogItemDto,
  FindCatalogQueryDto,
  UpdateCatalogItemDto,
} from '../catalog/dto/catalog.dto';

class UpdateCatalogItemStatusDto {
  @IsEnum(ReviewStatus)
  status: ReviewStatus;
}

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

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Апрув/реджект предложенной позиции справочника' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemStatusDto,
  ) {
    return this.catalog.updateStatus(id, dto.status);
  }

  @Post(':id/image')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Загрузить фото позиции справочника' })
  @UseInterceptors(
    FileInterceptor('file', {
      // storage не указан -> multer использует memoryStorage, на диск не пишем
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          callback(
            new BadRequestException('Файл должен быть изображением'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const ext = file.originalname.split('.').pop();
    const key = `catalog/${id}-${Date.now()}${ext ? `.${ext}` : ''}`;
    const imageUrl = await this.storage.upload(key, file.buffer, file.mimetype);
    return this.catalog.updateImage(id, imageUrl, user);
  }
}
