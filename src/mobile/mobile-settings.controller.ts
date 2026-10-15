import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from '../settings/settings.service';
import { MOBILE_API_VERSIONS } from '../common/decorators/api-version.decorator';

// Условия доставки для витрины: тариф + порог. Публичный эндпоинт — как остальная витрина.
@ApiTags('mobile/settings')
@Controller({ path: 'mobile/settings', version: MOBILE_API_VERSIONS })
export class MobileSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Платформенные условия доставки' })
  async get(): Promise<{
    deliveryFee: number;
    freeDeliveryThreshold: number | null;
  }> {
    const { deliveryFee, freeDeliveryThreshold } = await this.settings.get();
    return { deliveryFee, freeDeliveryThreshold };
  }
}
