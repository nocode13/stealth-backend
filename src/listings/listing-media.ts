import { MediaStatus, MediaType, Prisma } from '@prisma/client';

/**
 * Медиа в ответе покупателю. Одна форма для фото и видео любого источника:
 * мобилка не знает, чья это галерея — варианта (листинга) или позиции каталога.
 * id нужен клиенту только как ключ списка.
 */
export interface MediaResponse {
  id: string;
  type: MediaType;
  /** В кэше/мапперах — ключ S3; полный URL навешивает withMediaUrls на выходе. */
  url: string;
  posterUrl: string | null;
}

interface MediaRow {
  id: string;
  type: MediaType;
  url: string;
  posterUrl: string | null;
}

/** Готовая галерея для витрины: только READY, по порядку. */
export const readyMedia = {
  where: { status: MediaStatus.READY },
  orderBy: { sortOrder: 'asc' },
} satisfies Prisma.CatalogItemMediaFindManyArgs;

/**
 * Итоговая галерея листинга — ЕДИНСТВЕННОЕ место, где решается, откуда фото:
 * своя галерея варианта целиком заменяет галерею каталога; своей нет — каталог.
 * Этим же правилом пользуется обложка снапшота заказа (orders.service.ts).
 */
export function resolveMedia(listing: {
  media: MediaRow[];
  catalogItem: { media: MediaRow[] };
}): MediaResponse[] {
  const source = listing.media.length
    ? listing.media
    : listing.catalogItem.media;
  return source.map((m) => ({
    id: m.id,
    type: m.type,
    url: m.url,
    posterUrl: m.posterUrl,
  }));
}

/**
 * Обложка для снапшота позиции заказа. В галерее первым может стоять видео, а в
 * карточке заказа (админка, бот, история покупателя) нужна картинка — берём первое
 * фото, иначе обложку первого видео.
 */
export function coverUrl(media: MediaResponse[]): string | null {
  const image = media.find((m) => m.type === MediaType.IMAGE);
  if (image) return image.url;
  return media.find((m) => m.posterUrl)?.posterUrl ?? null;
}
