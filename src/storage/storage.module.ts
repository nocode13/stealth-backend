import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService, ImageService],
  exports: [StorageService, ImageService],
})
export class StorageModule {}
