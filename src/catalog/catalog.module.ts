import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { CountriesModule } from '../countries/countries.module';
import { CatalogService } from './catalog.service';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [CategoriesModule, CountriesModule, StorageModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
