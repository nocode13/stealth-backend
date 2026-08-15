import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { CartService } from './cart.service';

@Module({
  imports: [SettingsModule],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
