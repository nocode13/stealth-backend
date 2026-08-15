import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SettingsService } from '../settings/settings.service';
import { UpdatePlatformSettingsDto } from '../settings/dto/settings.dto';

// Платформенный тариф доставки — правит только SUPER_ADMIN, продавцы его не назначают.
@ApiTags('admin/settings')
@ApiCookieAuth()
@Controller('admin/settings')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Текущие платформенные настройки доставки' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({
    summary: 'Изменить тариф доставки / порог бесплатной доставки',
  })
  update(@Body() dto: UpdatePlatformSettingsDto) {
    return this.settings.update(dto);
  }
}
