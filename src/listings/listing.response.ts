import { Locale, ListingStatus, Prisma, Role } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import {
  CatalogItemResponse,
  toCatalogItemResponse,
} from '../catalog/catalog.response';
import {
  ListingPromotionResponse,
  toListingPromotionResponse,
} from '../promotions/promotion.response';

export type ListingWithTranslations = Prisma.ListingGetPayload<{
  include: {
    catalogItem: {
      include: {
        translations: true;
        category: { include: { translations: true } };
        country: { include: { translations: true } };
        media: true;
      };
    };
    seller: { select: { id: true; translations: true } };
    promotion: { include: { translations: true } };
  };
}>;

export type AdminListingWithTranslations = ListingWithTranslations &
  Prisma.ListingGetPayload<{
    include: { appliedRule: { select: { id: true; name: true } } };
  }>;

// Контракт мобилки: `price` — розница, которую платит покупатель (с акцией, если
// она есть), `oldPrice` — зачёркнутая «было» (null — не на акции). ⚠️ costPrice сюда
// не попадает НИКОГДА: поля перечислены явно, а не спредом Prisma-строки.
export interface ListingResponse {
  id: string;
  sellerId: string;
  seller: { id: string; name: string };
  catalogItemId: string;
  catalogItem: CatalogItemResponse;
  price: number;
  oldPrice: number | null;
  promotion: ListingPromotionResponse | null;
  stock: number;
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const toListingResponse = (
  l: ListingWithTranslations,
  locale: Locale,
): ListingResponse => ({
  id: l.id,
  sellerId: l.sellerId,
  seller: {
    id: l.seller.id,
    name: pickTranslation(l.seller.translations, locale).name,
  },
  catalogItemId: l.catalogItemId,
  catalogItem: toCatalogItemResponse(l.catalogItem, locale),
  price: l.price,
  // Инвариант PricingService: oldPrice и promotion либо оба есть, либо оба null.
  oldPrice: l.promotion ? l.oldPrice : null,
  promotion: l.promotion
    ? toListingPromotionResponse(l.promotion, locale)
    : null,
  stock: l.stock,
  status: l.status,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});

/**
 * Листинг для админки. costPrice видят все, розницу и сработавшее правило — только
 * SUPER_ADMIN: продавец знает лишь свою цену и сумму к выплате, наценку платформы
 * он не видит.
 */
export type AdminListingResponse = Omit<
  ListingResponse,
  'price' | 'oldPrice' | 'promotion'
> & {
  costPrice: number;
  /** Только SUPER_ADMIN. */
  price?: number;
  /** Только SUPER_ADMIN; null — базовая наценка из настроек платформы. */
  appliedRule?: { id: string; name: string } | null;
  /** Только SUPER_ADMIN; розница без акции, null — не на акции. */
  oldPrice?: number | null;
  /** Только SUPER_ADMIN; акция, давшая текущую price. */
  promotion?: { id: string; title: string } | null;
};

export const toAdminListingResponse = (
  l: AdminListingWithTranslations,
  locale: Locale,
  role: Role,
): AdminListingResponse => {
  const { price, oldPrice, promotion, ...base } = toListingResponse(l, locale);
  if (role !== Role.SUPER_ADMIN) return { ...base, costPrice: l.costPrice };
  return {
    ...base,
    costPrice: l.costPrice,
    price,
    appliedRule: l.appliedRule,
    oldPrice,
    promotion: promotion ? { id: promotion.id, title: promotion.title } : null,
  };
};
