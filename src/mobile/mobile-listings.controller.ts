import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListingsService } from '../listings/listings.service';
import { FindListingsQueryDto } from '../listings/dto/listing.dto';

// Витрина мобилки: активные листинги с остатком. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/listings')
@Controller('mobile/listings')
export class MobileListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Активные предложения (витрина)' })
  findAll(@Query() query: FindListingsQueryDto) {
    return this.listings.findStorefront(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Одно активное предложение (карточка товара)' })
  findOne(@Param('id') id: string) {
    return this.listings.findOnePublic(id);
  }
}
