import { ListingCardResponse } from '../listings/mobile-listing';

/**
 * Элемент ленты главной. Конверт с `type`, а не голый листинг: бэкенд сможет
 * подмешивать в ленту другие блоки (баннеры, подборки, ряды рекомендаций) без смены
 * контракта. Клиент обязан пропускать незнакомый `type`, а не падать на нём.
 */
export interface FeedListingItem {
  type: 'listing';
  /** Ключ элемента для клиента (у листинга — его id). */
  id: string;
  listing: ListingCardResponse;
}

export type FeedItem = FeedListingItem;
