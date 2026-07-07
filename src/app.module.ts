import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import configuration, { envValidationSchema } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SellersModule } from './sellers/sellers.module';
import { CatalogModule } from './catalog/catalog.module';
import { ListingsModule } from './listings/listings.module';
import { AdminModule } from './admin/admin.module';
import { MobileModule } from './mobile/mobile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
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
})
export class AppModule {}
