import { Locale, Prisma } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';
import { toEndDay, toStartDay } from '../pricing/business-day';
import type { PromotionState } from './dto/promotion.dto';

// ── Мобилка ──
// Акция на листинге: только то, что нужно карточке/деталке. Процент скидки клиент
// считает сам из price/oldPrice — у позиции он может быть свой (PromotionItem).

export type PromotionWithTranslations = Prisma.PromotionGetPayload<{
  include: { translations: true };
}>;

export interface ListingPromotionResponse {
  id: string;
  title: string;
  description: string | null;
  /** Последний день акции включительно (`YYYY-MM-DD`, Ташкент); null — бессрочно. */
  endDate: string | null;
}

export const toListingPromotionResponse = (
  p: PromotionWithTranslations,
  locale: Locale,
): ListingPromotionResponse => {
  const t = pickTranslation(p.translations, locale);
  return {
    id: p.id,
    title: t.title,
    description: t.description,
    endDate: toEndDay(p.endsAt),
  };
};

// ── Админка (только SUPER_ADMIN) ──

export const withAdminPromotion = {
  translations: true,
  _count: { select: { items: true } },
} satisfies Prisma.PromotionInclude;

export const withAdminPromotionItems = {
  ...withAdminPromotion,
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      listing: {
        select: {
          id: true,
          costPrice: true,
          price: true,
          oldPrice: true,
          promotionId: true,
          stock: true,
          status: true,
          seller: { select: { translations: true } },
          catalogItem: { select: { translations: true } },
        },
      },
    },
  },
} satisfies Prisma.PromotionInclude;

type AdminPromotionRow = Prisma.PromotionGetPayload<{
  include: typeof withAdminPromotion;
}>;
type AdminPromotionWithItems = Prisma.PromotionGetPayload<{
  include: typeof withAdminPromotionItems;
}>;

export interface AdminPromotionResponse {
  id: string;
  /** RU — для таблицы. */
  title: string;
  translations: {
    locale: Locale;
    title: string;
    description: string | null;
    auto: boolean;
  }[];
  discountBps: number;
  enabled: boolean;
  startDate: string | null;
  endDate: string | null;
  state: PromotionState;
  itemsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPromotionItemResponse {
  listingId: string;
  /** Своя скидка; null — скидка акции. */
  discountBps: number | null;
  listing: {
    id: string;
    name: string;
    sellerName: string;
    costPrice: number;
    /** Текущая розница (с акцией, если сработала). */
    price: number;
    oldPrice: number | null;
    /** Сейчас цена листинга посчитана именно по этой акции. */
    appliedHere: boolean;
    stock: number;
    status: string;
  };
}

export interface AdminPromotionDetailResponse extends AdminPromotionResponse {
  items: AdminPromotionItemResponse[];
}

export function promotionState(
  p: { enabled: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): PromotionState {
  if (!p.enabled) return 'disabled';
  if (p.startsAt && now < p.startsAt) return 'scheduled';
  if (p.endsAt && now >= p.endsAt) return 'ended';
  return 'active';
}

export const toAdminPromotionResponse = (
  p: AdminPromotionRow,
  now: Date,
): AdminPromotionResponse => ({
  id: p.id,
  title: pickTranslation(p.translations, DEFAULT_LOCALE).title,
  translations: SUPPORTED_LOCALES.map((locale) => {
    const t = pickTranslation(p.translations, locale);
    return {
      locale,
      title: t.title,
      description: t.description,
      auto: t.auto,
    };
  }),
  discountBps: p.discountBps,
  enabled: p.enabled,
  startDate: toStartDay(p.startsAt),
  endDate: toEndDay(p.endsAt),
  state: promotionState(p, now),
  itemsCount: p._count.items,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

export const toAdminPromotionDetailResponse = (
  p: AdminPromotionWithItems,
  now: Date,
): AdminPromotionDetailResponse => ({
  ...toAdminPromotionResponse(p, now),
  items: p.items.map((item) => ({
    listingId: item.listingId,
    discountBps: item.discountBps,
    listing: {
      id: item.listing.id,
      name: pickTranslation(
        item.listing.catalogItem.translations,
        DEFAULT_LOCALE,
      ).name,
      sellerName: pickTranslation(
        item.listing.seller.translations,
        DEFAULT_LOCALE,
      ).name,
      costPrice: item.listing.costPrice,
      price: item.listing.price,
      oldPrice: item.listing.oldPrice,
      appliedHere: item.listing.promotionId === p.id,
      stock: item.listing.stock,
      status: item.listing.status,
    },
  })),
});
