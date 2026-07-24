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
import { StorageService } from '../storage/storage.service';
import { SellersService } from '../sellers/sellers.service';
import {
  CreateSellerDto,
  FindSellersQueryDto,
  UpdateSellerDto,
} from '../sellers/dto/seller.dto';

// Управление продавцами — только супер-админ (готовность к мультипродавцу).
@ApiTags('admin/sellers')
@ApiCookieAuth()
@Controller('admin/sellers')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSellersController {
  constructor(
    private readonly sellers: SellersService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список продавцов' })
  findAll(@Query() query: FindSellersQueryDto) {
    return this.sellers.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sellers.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать продавца (+ владелец с логином в админку)',
  })
  create(@Body() dto: CreateSellerDto) {
    return this.sellers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить название/описание/статус продавца' })
  update(@Param('id') id: string, @Body() dto: UpdateSellerDto) {
    return this.sellers.update(id, dto);
  }

  @Post(':id/image')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Загрузить баннер продавца' })
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
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const ext = file.originalname.split('.').pop();
    const key = `sellers/${id}-${Date.now()}${ext ? `.${ext}` : ''}`;
    const bannerUrl = await this.storage.upload(
      key,
      file.buffer,
      file.mimetype,
    );
    return this.sellers.updateBanner(id, bannerUrl);
  }
}
