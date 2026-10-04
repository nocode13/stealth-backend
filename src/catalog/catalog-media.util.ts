import type { StorageService } from '../storage/storage.service';

interface HasMedia {
  media: { url: string; posterUrl: string | null }[];
}

// В БД media.url/posterUrl хранят ключ S3-объекта — здесь собираем полный URL для
// ответа фронту. Переиспользуется CatalogService, ListingsService, CartService и
// FavoritesService: у каталога и мобильного листинга галерея лежит в `media`
// напрямую, у админского листинга — ещё и в `.catalogItem`/`ownMedia`.
export function withMediaUrls<T extends HasMedia>(
  storage: StorageService,
  item: T,
): T {
  // Спред против общего T не проходит проверку типов (TS не может доказать, что
  // результат совместим с произвольным T) — форма гарантированно та же, кроме
  // значений url/posterUrl, поэтому приведение типа безопасно.
  return {
    ...item,
    media: item.media.map((m) => ({
      ...m,
      url: storage.getUrl(m.url),
      posterUrl: storage.getUrlOrNull(m.posterUrl),
    })),
  };
}
