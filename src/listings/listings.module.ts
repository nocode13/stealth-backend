import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { StorageModule } from '../storage/storage.module';
import { ListingsService } from './listings.service';

@Module({
  imports: [CatalogModule, StorageModule],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
