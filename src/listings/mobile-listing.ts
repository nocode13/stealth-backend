import { ListingStatus, Locale, Prisma } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import {
  ListingPromotionResponse,
  toListingPromotionResponse,
} from '../promotions/promotion.response';
import { MediaResponse, readyMedia, resolveMedia } from './listing-media';
import { VariantFields, pickVariant } from './variant';

/**
 * Контракт листинга для мобилки — ЕДИНСТВЕННОЕ место, где он собирается. Им
 * пользуются витрина (ListingsService), избранное (FavoritesService) и корзина
 * (CartService): новое поле листинга добавляется здесь один раз, а не в трёх копиях
 * include и мапперов.
 *
 * Ответ плоский: каталог, вариант и цена лежат на одном уровне, мобилка не знает,
 * что под листингом есть позиция каталога. `media` — итоговая галерея (см.
 * resolveMedia): свои фото варианта, иначе фото каталога.
 *
 * ⚠️ Поля перечислены явно, без спреда Prisma-строки: в ней лежат costPrice и
 * customMarkupBps, себестоимость покупателю не уходит никогда.
 *
 * URL медиа здесь — ещё ключи S3: мапперы зовутся ВНУТРИ cache.wrap, а полный URL
 * навешивает withMediaUrls уже на выходе (как в CatalogService).
 */
export const mobileListingInclude = {
  catalogItem: {
    include: {
      translations: true,
      category: { include: { translations: true } },
      country: { include: { translations: true } },
      media: readyMedia,
    },
  },
  media: readyMedia,
  seller: { select: { id: true, translations: true } },
  promotion: { include: { translations: true } },
} satisfies Prisma.ListingInclude;

export type MobileListingRow = Prisma.ListingGetPayload<{
  include: typeof mobileListingInclude;
}>;

/** Карточка в списках: витрина, новинки, продавец, reels, избранное. */
export interface ListingCardResponse extends VariantFields {
  id: string;
  /** Артикул: показывается как «#10001», идёт в короткую ссылку app.egen.uz/l/<code>. */
  code: number;
  name: string;
  /** HTML (tiptap, санитизирован на входе). Нужен и в списке — его показывает лента reels. */
  description: string | null;
  unit: string;
  /** Розница — с акцией, если она есть. */
  price: number;
  /** Розница без акции (зачёркнутая «было»); null — не на акции. */
  oldPrice: number | null;
  stock: number;
  /** ACTIVE и есть остаток. Витрина отдаёт только такие; избранному — нет. */
  available: boolean;
  freeDelivery: boolean;
  category: { id: string; name: string } | null;
  country: { code: string; name: string } | null;
  media: MediaResponse[];
  createdAt: Date;
}

/** Вариант той же позиции у того же продавца — чипы на карточке товара. */
export interface ListingVariantResponse extends VariantFields {
  id: string;
  price: number;
  oldPrice: number | null;
}

/** GET /mobile/listings/:id. */
export interface ListingDetailResponse extends ListingCardResponse {
  promotion: ListingPromotionResponse | null;
  seller: { id: string; name: string };
  /** Все доступные варианты, включая текущий, в порядке VARIANT_ORDER_BY. */
  variants: ListingVariantResponse[];
}

/**
 * Листинг внутри корзины: акция и id продавца (чекаут предупреждает, что заказ
 * разделится по продавцам). Имя продавца корзине не нужно.
 */
export interface CartListingResponse extends ListingCardResponse {
  sellerId: string;
  promotion: ListingPromotionResponse | null;
}

/** select для соседних вариантов (findOnePublic). */
export const listingVariantSelect = {
  id: true,
  price: true,
  oldPrice: true,
  promotionId: true,
  seedling: true,
  potVolumeMl: true,
  stemCount: true,
  heightCm: true,
} satisfies Prisma.ListingSelect;

export const toListingVariant = (
  l: Prisma.ListingGetPayload<{ select: typeof listingVariantSelect }>,
): ListingVariantResponse => ({
  id: l.id,
  ...pickVariant(l),
  price: l.price,
  // Инвариант PricingService: oldPrice есть ровно тогда, когда есть акция.
  oldPrice: l.promotionId ? l.oldPrice : null,
});

export function toListingCard(
  l: MobileListingRow,
  locale: Locale,
): ListingCardResponse {
  const item = l.catalogItem;
  const t = pickTranslation(item.translations, locale);
  return {
    id: l.id,
    code: l.code,
    name: t.name,
    description: t.description,
    unit: t.unit,
    ...pickVariant(l),
    price: l.price,
    oldPrice: l.promotion ? l.oldPrice : null,
    stock: l.stock,
    available: l.status === ListingStatus.ACTIVE && l.stock > 0,
    freeDelivery: item.freeDelivery,
    category: item.category
      ? {
          id: item.category.id,
          name: pickTranslation(item.category.translations, locale).name,
        }
      : null,
    country: item.country
      ? {
          code: item.country.code,
          name: pickTranslation(item.country.translations, locale).name,
        }
      : null,
    media: resolveMedia(l),
    createdAt: l.createdAt,
  };
}

export function toListingDetail(
  l: MobileListingRow,
  variants: ListingVariantResponse[],
  locale: Locale,
): ListingDetailResponse {
  return {
    ...toListingCard(l, locale),
    promotion: l.promotion
      ? toListingPromotionResponse(l.promotion, locale)
      : null,
    seller: {
      id: l.seller.id,
      name: pickTranslation(l.seller.translations, locale).name,
    },
    variants,
  };
}

export const toCartListing = (
  l: MobileListingRow,
  locale: Locale,
): CartListingResponse => ({
  ...toListingCard(l, locale),
  sellerId: l.sellerId,
  promotion: l.promotion
    ? toListingPromotionResponse(l.promotion, locale)
    : null,
});
