import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { CountriesModule } from '../countries/countries.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingsModule } from '../listings/listings.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OrdersModule } from '../orders/orders.module';
import { SellersModule } from '../sellers/sellers.module';
import { SettingsModule } from '../settings/settings.module';
import { PricingModule } from '../pricing/pricing.module';
import { AppVersionModule } from '../app-version/app-version.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BroadcastsModule } from '../broadcasts/broadcasts.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { UsersModule } from '../users/users.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminCountriesController } from './admin-countries.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminListingsController } from './admin-listings.controller';
import { AdminMetricsController } from './admin-metrics.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminSellersController } from './admin-sellers.controller';
import { AdminSellerStaffController } from './admin-seller-staff.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminAppVersionsController } from './admin-app-versions.controller';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminPromotionsController } from './admin-promotions.controller';
import { AdminPriceRulesController } from './admin-price-rules.controller';

// API-поверхность админки. Логика — в доменных модулях, тут только контроллеры
// с session-guard'ами и Swagger-тегами.
@Module({
  imports: [
    AuthModule,
    CategoriesModule,
    CountriesModule,
    CatalogModule,
    ListingsModule,
    MetricsModule,
    OrdersModule,
    SellersModule,
    SettingsModule,
    PricingModule,
    AppVersionModule,
    StorageModule,
    TelegramModule,
    BroadcastsModule,
    UsersModule,
    PromotionsModule,
  ],
  controllers: [
    AdminAuthController,
    AdminCategoriesController,
    AdminCountriesController,
    AdminCatalogController,
    AdminListingsController,
    AdminMetricsController,
    AdminOrdersController,
    AdminSellersController,
    AdminSellerStaffController,
    AdminSettingsController,
    AdminAppVersionsController,
    AdminBroadcastsController,
    AdminCustomersController,
    AdminPromotionsController,
    AdminPriceRulesController,
  ],
})
export class AdminModule {}
