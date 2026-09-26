import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { PromotionsService } from './promotions.service';

// Акции — домен поверх ценообразования: цены по ним считает PricingService
// (второй этап движка), здесь только CRUD кампаний и их состава.
@Module({
  imports: [PricingModule],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
