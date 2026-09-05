import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Locale } from '@prisma/client';
import { ReqLocale } from '../common/decorators/locale.decorator';
import { AppVersionService } from '../app-version/app-version.service';
import type { AppVersionCheck } from '../app-version/app-version.service';
import { CheckAppVersionQueryDto } from '../app-version/dto/app-version.dto';

// Версия в сторе для плашки «обновитесь». Публичный эндпоинт — как остальная витрина:
// force-update обязан работать и для неавторизованной установки, иначе застрявший на
// старой версии пользователь не увидит экран, пока не залогинится.
@ApiTags('mobile/app-version')
@Controller('mobile/app-version')
export class MobileAppVersionController {
  constructor(private readonly appVersion: AppVersionService) {}

  @Get()
  @ApiOperation({
    summary: 'Актуальная версия приложения в сторе',
    description:
      'Отдаёт вердикт по установленной версии. Отсутствие настроек, выключенная ' +
      'платформа и непереданная version — всегда 200 с updateAvailable/Required: false.',
  })
  check(
    @Query() query: CheckAppVersionQueryDto,
    @ReqLocale() locale: Locale,
  ): Promise<AppVersionCheck> {
    return this.appVersion.check(query.platform, query.version, locale);
  }
}
