import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { CartService } from './cart.service';

@Module({
  imports: [SettingsModule, StorageModule],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
