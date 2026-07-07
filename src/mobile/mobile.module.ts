import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OtpModule } from '../otp/otp.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingsModule } from '../listings/listings.module';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileCatalogController } from './mobile-catalog.controller';
import { MobileListingsController } from './mobile-listings.controller';

// API-поверхность мобилки. JWT-guard'ы + Swagger-теги, логика в доменных модулях.
@Module({
  imports: [AuthModule, OtpModule, CatalogModule, ListingsModule],
  controllers: [
    MobileAuthController,
    MobileCatalogController,
    MobileListingsController,
  ],
})
export class MobileModule {}
