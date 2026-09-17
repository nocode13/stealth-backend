import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [StorageModule],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
