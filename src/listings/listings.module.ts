import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingsService } from './listings.service';

@Module({
  imports: [CatalogModule],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
