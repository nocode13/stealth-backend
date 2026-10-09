import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CategoriesService } from './categories.service';

@Module({
  imports: [StorageModule],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
