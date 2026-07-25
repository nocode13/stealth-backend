import { Module } from '@nestjs/common';
import { SellersService } from './sellers.service';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  providers: [SellersService],
  exports: [SellersService],
  imports: [StorageModule],
})
export class SellersModule {}
