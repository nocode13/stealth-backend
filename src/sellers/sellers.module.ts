import { Module } from '@nestjs/common';
import { SellersService } from './sellers.service';
import { SellerStaffService } from './seller-staff.service';
import { StorageModule } from 'src/storage/storage.module';
import { TelegramLinkModule } from '../telegram/telegram-link.module';
import { UsersModule } from '../users/users.module';

@Module({
  providers: [SellersService, SellerStaffService],
  exports: [SellersService, SellerStaffService],
  imports: [StorageModule, UsersModule, TelegramLinkModule],
})
export class SellersModule {}
