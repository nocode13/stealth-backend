import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingsModule } from '../listings/listings.module';
import { SellersModule } from '../sellers/sellers.module';
import { StorageModule } from '../storage/storage.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminListingsController } from './admin-listings.controller';
import { AdminSellersController } from './admin-sellers.controller';

// API-поверхность админки. Логика — в доменных модулях, тут только контроллеры
// с session-guard'ами и Swagger-тегами.
@Module({
  imports: [
    AuthModule,
    CategoriesModule,
    CatalogModule,
    ListingsModule,
    SellersModule,
    StorageModule,
  ],
  controllers: [
    AdminAuthController,
    AdminCategoriesController,
    AdminCatalogController,
    AdminListingsController,
    AdminSellersController,
  ],
})
export class AdminModule {}
