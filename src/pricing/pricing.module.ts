import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PricingService } from './pricing.service';

// Зависит только от SettingsModule (базовая наценка). SettingsModule обратно его НЕ
// импортирует: пересчёт после смены наценки зовёт admin-settings.controller.ts —
// так цикла нет и forwardRef не нужен.
@Module({
  imports: [SettingsModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
