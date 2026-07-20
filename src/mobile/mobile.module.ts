import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { CategoriesModule } from '../categories/categories.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingsModule } from '../listings/listings.module';
import { CartModule } from '../cart/cart.module';
import { OrdersModule } from '../orders/orders.module';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileCategoriesController } from './mobile-categories.controller';
import { MobileCatalogController } from './mobile-catalog.controller';
import { MobileListingsController } from './mobile-listings.controller';
import { MobileCartController } from './mobile-cart.controller';
import { MobileOrdersController } from './mobile-orders.controller';

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
  ],
  controllers: [
    MobileAuthController,
    MobileCategoriesController,
    MobileCatalogController,
    MobileListingsController,
    MobileCartController,
    MobileOrdersController,
  ],
})
export class MobileModule {}
