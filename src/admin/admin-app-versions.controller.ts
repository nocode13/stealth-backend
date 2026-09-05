import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AppPlatform, Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AppVersionService } from '../app-version/app-version.service';
import { UpdateAppVersionDto } from '../app-version/dto/app-version.dto';

// Версии в сторах правит только SUPER_ADMIN: неверное minSupportedVersion блокирует
// вход всем пользователям платформы, продавцу такой рубильник не нужен.
@ApiTags('admin/app-versions')
@ApiCookieAuth()
@Controller('admin/app-versions')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminAppVersionsController {
  constructor(private readonly appVersion: AppVersionService) {}

  @Get()
  @ApiOperation({ summary: 'Версии приложения по платформам' })
  list() {
    return this.appVersion.list();
  }

  @Patch(':platform')
  @ApiParam({ name: 'platform', enum: AppPlatform })
  @ApiOperation({
    summary: 'Изменить версии для платформы',
    description:
      'minSupportedVersion выше latestVersion клиент игнорирует (force-update не ' +
      'включается) — чтобы опечатка не заблокировала всех.',
  })
  update(
    // ParseEnumPipe обязателен: без него неизвестная платформа дошла бы до upsert
    // и упала 500-й вместо понятной 400-й.
    @Param('platform', new ParseEnumPipe(AppPlatform)) platform: AppPlatform,
    @Body() dto: UpdateAppVersionDto,
  ) {
    return this.appVersion.update(platform, dto);
  }
}
