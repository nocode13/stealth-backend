import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from '../settings/settings.service';

// Условия доставки для витрины: тариф + порог. Публичный эндпоинт — как остальная витрина.
@ApiTags('mobile/settings')
@Controller('mobile/settings')
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
