import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { SellersService } from '../sellers/sellers.service';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Витрина мобилки: страница продавца. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/sellers')
@Controller('mobile/sellers')
export class MobileSellersController {
  constructor(private readonly sellers: SellersService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Активный продавец (страница продавца)' })
  findOne(@Param('id') id: string, @ReqLocale() locale: Locale) {
    return this.sellers.findOnePublic(id, locale);
  }
}
