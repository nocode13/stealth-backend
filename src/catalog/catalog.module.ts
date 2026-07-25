import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { CatalogService } from './catalog.service';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [CategoriesModule, StorageModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
