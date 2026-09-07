import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { ListingsService } from '../listings/listings.service';
import { FindListingsQueryDto } from '../listings/dto/listing.dto';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Витрина мобилки: активные листинги с остатком. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/listings')
@Controller('mobile/listings')
export class MobileListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Активные предложения (витрина)' })
  findAll(@Query() query: FindListingsQueryDto, @ReqLocale() locale: Locale) {
    return this.listings.findStorefront(query, locale);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Одно активное предложение (карточка товара)' })
  findOne(@Param('id') id: string, @ReqLocale() locale: Locale) {
    return this.listings.findOnePublic(id, locale);
  }
}
