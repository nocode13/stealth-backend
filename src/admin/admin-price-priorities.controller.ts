import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PricingService } from '../pricing/pricing.service';
import { UpdatePricePrioritiesDto } from '../pricing/dto/price-priority.dto';

// Порядок источников цены (акция / своя наценка листинга / базовая ступенчатая).
// Только SUPER_ADMIN: продавец наценку не видит.
@ApiTags('admin/price-priorities')
@ApiCookieAuth()
@Controller('admin/price-priorities')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPricePrioritiesController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @ApiOperation({ summary: 'Источники цены сверху вниз' })
  get() {
    return this.pricing.getPriorities();
  }

  @Put()
  @ApiOperation({
    summary:
      'Задать порядок источников целиком — цены всей витрины пересчитываются сразу',
  })
  update(@Body() dto: UpdatePricePrioritiesDto) {
    return this.pricing.setPriorities(dto.order);
  }
}
