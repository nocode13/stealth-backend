import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PricingService } from './pricing.service';
import { PricingScheduler } from './pricing.scheduler';

// Зависит только от SettingsModule (шаг округления). SettingsModule обратно его НЕ
// импортирует: пересчёт после смены наценки зовёт admin-settings.controller.ts через
// PricingService — так цикла нет и forwardRef не нужен. PricingScheduler — полуночный
// тикер для акций с датами.
@Module({
  imports: [SettingsModule],
  providers: [PricingService, PricingScheduler],
  exports: [PricingService],
})
export class PricingModule {}
