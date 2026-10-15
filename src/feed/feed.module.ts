import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { FeedService } from './feed.service';

@Module({
  imports: [ListingsModule],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
