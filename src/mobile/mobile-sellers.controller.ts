import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellersService } from '../sellers/sellers.service';

// Витрина мобилки: страница продавца. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/sellers')
@Controller('mobile/sellers')
export class MobileSellersController {
  constructor(private readonly sellers: SellersService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Активный продавец (страница продавца)' })
  findOne(@Param('id') id: string) {
    return this.sellers.findOnePublic(id);
  }
}
