import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { MediaGalleryService } from './media-gallery.service';
import { MediaProcessingService } from './media-processing.service';
import { StorageService } from './storage.service';
import { VideoService } from './video.service';

@Module({
  providers: [
    StorageService,
    ImageService,
    VideoService,
    MediaProcessingService,
    MediaGalleryService,
  ],
  exports: [
    StorageService,
    ImageService,
    VideoService,
    MediaProcessingService,
    MediaGalleryService,
  ],
})
export class StorageModule {}
