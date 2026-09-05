import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { CategoriesModule } from '../categories/categories.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingsModule } from '../listings/listings.module';
import { CartModule } from '../cart/cart.module';
import { OrdersModule } from '../orders/orders.module';
import { SellersModule } from '../sellers/sellers.module';
import { SettingsModule } from '../settings/settings.module';
import { AppVersionModule } from '../app-version/app-version.module';
import { AddressesModule } from '../addresses/addresses.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
import { StorageModule } from '../storage/storage.module';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileCategoriesController } from './mobile-categories.controller';
import { MobileCatalogController } from './mobile-catalog.controller';
import { MobileListingsController } from './mobile-listings.controller';
import { MobileCartController } from './mobile-cart.controller';
import { MobileOrderGroupsController } from './mobile-order-groups.controller';
import { MobileSellersController } from './mobile-sellers.controller';
import { MobileAddressesController } from './mobile-addresses.controller';
import { MobileNotificationsController } from './mobile-notifications.controller';
import { MobileSettingsController } from './mobile-settings.controller';
import { MobileAppVersionController } from './mobile-app-version.controller';

// API-поверхность мобилки. JWT-guard'ы + Swagger-теги, логика в доменных модулях.
@Module({
  imports: [
    AuthModule,
    TelegramModule,
    UsersModule,
    CategoriesModule,
    CatalogModule,
    ListingsModule,
    CartModule,
    OrdersModule,
    SellersModule,
    SettingsModule,
    AppVersionModule,
    AddressesModule,
    NotificationsModule,
    PushModule,
    StorageModule,
  ],
  controllers: [
    MobileAuthController,
    MobileCategoriesController,
    MobileCatalogController,
    MobileListingsController,
    MobileCartController,
    MobileOrderGroupsController,
    MobileSellersController,
    MobileAddressesController,
    MobileNotificationsController,
    MobileSettingsController,
    MobileAppVersionController,
  ],
})
export class MobileModule {}
