import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';

@Module({
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
