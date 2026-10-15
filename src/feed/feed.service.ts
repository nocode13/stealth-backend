import { Injectable } from '@nestjs/common';
import { Locale } from '@prisma/client';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { CursorPage } from '../common/pagination';
import { ListingsService } from '../listings/listings.service';
import { FeedItem } from './feed.response';

/**
 * Лента главной мобилки — «всё вперемешку». Порядок решает только бэкенд: клиент
 * не шлёт ни фильтров, ни сортировки, поэтому сюда потом встаёт рекомендательная
 * система, не трогая поиск и экраны категорий (они ходят в /mobile/listings).
 *
 * Сейчас это дефолтная витрина: акционные первыми, затем новые. Кэш — тот же
 * 'listings' внутри ListingsService.findStorefront, своего слоя кэша не нужно.
 * Курсор — id последнего листинга страницы (id элемента = id листинга).
 */
@Injectable()
export class FeedService {
  constructor(private readonly listings: ListingsService) {}

  async findFeed(
    query: CursorPaginationDto,
    locale: Locale,
  ): Promise<CursorPage<FeedItem>> {
    const page = await this.listings.findStorefront(
      { cursor: query.cursor, limit: query.limit },
      locale,
    );
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((listing) => ({
        type: 'listing',
        id: listing.id,
        listing,
      })),
    };
  }
}
