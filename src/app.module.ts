import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import configuration, { envValidationSchema } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SellersModule } from './sellers/sellers.module';
import { CatalogModule } from './catalog/catalog.module';
import { ListingsModule } from './listings/listings.module';
import { AdminModule } from './admin/admin.module';
import { MobileModule } from './mobile/mobile.module';
import { LocalizedExceptionFilter } from './common/filters/localized-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    CacheModule,
    // Доменные модули (бизнес-логика + доступ к БД).
    UsersModule,
    AuthModule,
    SellersModule,
    CatalogModule,
    ListingsModule,
    // API-поверхности.
    AdminModule,
    MobileModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: LocalizedExceptionFilter }],
})
export class AppModule {}
