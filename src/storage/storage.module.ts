import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { MediaProcessingService } from './media-processing.service';
import { StorageService } from './storage.service';
import { VideoService } from './video.service';

@Module({
  providers: [
    StorageService,
    ImageService,
    VideoService,
    MediaProcessingService,
  ],
  exports: [StorageService, ImageService, VideoService, MediaProcessingService],
})
export class StorageModule {}
