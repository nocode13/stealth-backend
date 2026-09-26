import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PricingService } from './pricing.service';
import { PricingScheduler } from './pricing.scheduler';
import { PriceRulesService } from './price-rules.service';

// Зависит только от SettingsModule (базовая наценка). SettingsModule обратно его НЕ
// импортирует: пересчёт после смены наценки зовёт admin-settings.controller.ts —
// так цикла нет и forwardRef не нужен. PricingScheduler — полуночный тикер для
// правил/акций с датами, PriceRulesService — CRUD правил (admin/price-rules).
@Module({
  imports: [SettingsModule],
  providers: [PricingService, PricingScheduler, PriceRulesService],
  exports: [PricingService, PriceRulesService],
})
export class PricingModule {}
