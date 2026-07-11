import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { CatalogService } from './catalog.service';

@Module({
  imports: [CategoriesModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
