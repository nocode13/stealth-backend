import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { SellersService } from '../sellers/sellers.service';
import { ReqLocale } from '../common/decorators/locale.decorator';
import { MOBILE_API_VERSIONS } from '../common/decorators/api-version.decorator';

// Витрина мобилки: страница продавца. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/sellers')
@Controller({ path: 'mobile/sellers', version: MOBILE_API_VERSIONS })
export class MobileSellersController {
  constructor(private readonly sellers: SellersService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Активный продавец (страница продавца)' })
  findOne(@Param('id') id: string, @ReqLocale() locale: Locale) {
    return this.sellers.findOnePublic(id, locale);
  }
}
