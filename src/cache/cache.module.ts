import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// @Global по той же причине, что и PrismaModule: CacheService нужен и в доменных
// модулях, которые подтягиваются транзитивно через Admin/Mobile, — иначе пришлось
// бы прописывать импорт в каждом.
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
