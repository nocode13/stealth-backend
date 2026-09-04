import { CatalogItemMedia, Locale, Prisma, ReviewStatus } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';
import {
  CategoryResponse,
  toCategoryResponse,
} from '../categories/category.response';

export type CatalogItemWithTranslations = Prisma.CatalogItemGetPayload<{
  include: {
    translations: true;
    category: { include: { translations: true } };
    media: true;
  };
}>;

export interface CatalogItemResponse {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  categoryId: string | null;
  category: CategoryResponse | null;
  media: CatalogItemMedia[];
  sellerId: string | null;
  status: ReviewStatus;
  freeDelivery: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminCatalogItemResponse extends CatalogItemResponse {
  translations: {
    locale: Locale;
    name: string;
    description: string | null;
    unit: string;
    auto: boolean;
  }[];
}

export const toCatalogItemResponse = (
  item: CatalogItemWithTranslations,
  locale: Locale,
): CatalogItemResponse => {
  const t = pickTranslation(item.translations, locale);
  return {
    id: item.id,
    name: t.name,
    description: t.description,
    unit: t.unit,
    categoryId: item.categoryId,
    category: item.category ? toCategoryResponse(item.category, locale) : null,
    // media отдаём как есть (в БД ключи S3) — полные URL навешивает withMediaUrls
    // ПОСЛЕ cache.wrap, как и раньше.
    media: item.media,
    sellerId: item.sellerId,
    status: item.status,
    freeDelivery: item.freeDelivery,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

export const toAdminCatalogItemResponse = (
  item: CatalogItemWithTranslations,
): AdminCatalogItemResponse => ({
  ...toCatalogItemResponse(item, DEFAULT_LOCALE),
  translations: SUPPORTED_LOCALES.map((locale) => {
    const t = pickTranslation(item.translations, locale);
    return {
      locale,
      name: t.name,
      description: t.description,
      unit: t.unit,
      auto: t.auto,
    };
  }),
});
