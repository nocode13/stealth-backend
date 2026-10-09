import {
  CatalogItemMedia,
  Locale,
  ListingStatus,
  PriceSource,
  Prisma,
  Role,
} from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import {
  CatalogItemResponse,
  toCatalogItemResponse,
} from '../catalog/catalog.response';
import { toListingPromotionResponse } from '../promotions/promotion.response';
import { readyMedia } from './listing-media';
import { VariantFields, pickVariant } from './variant';

// Контракт мобилки живёт в mobile-listing.ts — здесь только админка. Она по-прежнему
// получает вложенный catalogItem (форма редактирования и таблицы его читают).
//
// catalogItem.media — только READY (превью в таблице; галерея каталога
// редактируется в каталоге). Своя галерея листинга — целиком, с PROCESSING/FAILED:
// админка обязана показывать, что видео ещё обрабатывается.
export const adminListingInclude = {
  catalogItem: {
    include: {
      translations: true,
      category: { include: { translations: true } },
      subcategory: { include: { translations: true } },
      country: { include: { translations: true } },
      media: readyMedia,
    },
  },
  media: { orderBy: { sortOrder: 'asc' } },
  seller: { select: { id: true, translations: true } },
  // Акция, давшая текущую price (название в таблицу). Пишет PricingService.
  promotion: { include: { translations: true } },
} satisfies Prisma.ListingInclude;

export type AdminListingRow = Prisma.ListingGetPayload<{
  include: typeof adminListingInclude;
}>;

/**
 * Листинг для админки. costPrice видят все, розницу, источник цены и свою наценку —
 * только SUPER_ADMIN: продавец знает лишь свою цену и сумму к выплате, наценку
 * платформы он не видит.
 */
export interface AdminListingResponse extends VariantFields {
  id: string;
  /** Артикул: показывается как «#10001». */
  code: number;
  /** Код продавца; null — не задан. */
  sku: string | null;
  sellerId: string;
  seller: { id: string; name: string };
  catalogItemId: string;
  catalogItem: CatalogItemResponse;
  /** Своя галерея варианта (все статусы). Пустая — на витрине фото каталога. */
  ownMedia: CatalogItemMedia[];
  costPrice: number;
  stock: number;
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
  /** Только SUPER_ADMIN. */
  price?: number;
  /** Только SUPER_ADMIN; своя наценка, bps; null — базовая ступенчатая. */
  customMarkupBps?: number | null;
  /** Только SUPER_ADMIN; какой источник дал текущую price. */
  priceSource?: PriceSource;
  /** Только SUPER_ADMIN; розница без акции, null — не на акции. */
  oldPrice?: number | null;
  /** Только SUPER_ADMIN; акция, давшая текущую price. */
  promotion?: { id: string; title: string } | null;
}

export const toAdminListingResponse = (
  l: AdminListingRow,
  locale: Locale,
  role: Role,
): AdminListingResponse => {
  const base = {
    id: l.id,
    code: l.code,
    sku: l.sku,
    sellerId: l.sellerId,
    seller: {
      id: l.seller.id,
      name: pickTranslation(l.seller.translations, locale).name,
    },
    catalogItemId: l.catalogItemId,
    catalogItem: toCatalogItemResponse(l.catalogItem, locale),
    ...pickVariant(l),
    ownMedia: l.media,
    costPrice: l.costPrice,
    stock: l.stock,
    status: l.status,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
  if (role !== Role.SUPER_ADMIN) return base;
  return {
    ...base,
    price: l.price,
    customMarkupBps: l.customMarkupBps,
    priceSource: l.priceSource,
    // Инвариант PricingService: oldPrice и promotion либо оба есть, либо оба null.
    oldPrice: l.promotion ? l.oldPrice : null,
    promotion: l.promotion
      ? {
          id: l.promotion.id,
          title: toListingPromotionResponse(l.promotion, locale).title,
        }
      : null,
  };
};
