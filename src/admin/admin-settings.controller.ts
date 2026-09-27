import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PricingService } from '../pricing/pricing.service';
import { UpdatePlatformSettingsDto } from '../settings/dto/settings.dto';

// Платформенный тариф доставки и ступени базовой наценки — правит только SUPER_ADMIN,
// продавцы их не назначают (и наценку не видят вовсе). Ступени живут в pricing/,
// поэтому оба хендлера идут через PricingService.
@ApiTags('admin/settings')
@ApiCookieAuth()
@Controller('admin/settings')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSettingsController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @ApiOperation({
    summary: 'Текущие платформенные настройки доставки и наценки',
  })
  get() {
    return this.pricing.getSettings();
  }

  @Patch()
  @ApiOperation({
    summary:
      'Изменить тариф доставки / порог бесплатной доставки / ступени наценки. ' +
      'Смена ступеней или округления пересчитывает цены всей витрины.',
  })
  update(@Body() dto: UpdatePlatformSettingsDto) {
    return this.pricing.updateSettings(dto);
  }
}
