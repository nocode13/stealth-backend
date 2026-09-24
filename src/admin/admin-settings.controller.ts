import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SettingsService } from '../settings/settings.service';
import { PricingService } from '../pricing/pricing.service';
import { UpdatePlatformSettingsDto } from '../settings/dto/settings.dto';

// Платформенный тариф доставки и базовая наценка — правит только SUPER_ADMIN,
// продавцы их не назначают (и наценку не видят вовсе).
@ApiTags('admin/settings')
@ApiCookieAuth()
@Controller('admin/settings')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Текущие платформенные настройки доставки и наценки',
  })
  get() {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({
    summary:
      'Изменить тариф доставки / порог бесплатной доставки / наценку. ' +
      'Смена наценки или округления пересчитывает цены всей витрины.',
  })
  update(@Body() dto: UpdatePlatformSettingsDto) {
    return this.pricing.updateSettings(dto);
  }
}
