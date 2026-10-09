import { Locale, Prisma, ReviewStatus } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';

export const adminCategoryInclude = {
  translations: true,
  // Счётчики для колонок админки. Считают ВСЁ, без учёта видимости для SELLER —
  // точное число видит SUPER_ADMIN. У категории верхнего уровня позиции висят на
  // catalogItems, у подкатегории — на subcatalogItems; второй счётчик всегда 0.
  _count: {
    select: { catalogItems: true, subcatalogItems: true, children: true },
  },
} satisfies Prisma.CategoryInclude;

export type CategoryWithTranslations = Prisma.CategoryGetPayload<{
  include: typeof adminCategoryInclude;
}>;

/**
 * Мобилка: плоское резолвленное имя, ни одной локали в контракте.
 * ⚠️ Маппер кладёт в iconUrl сырой ключ S3 (iconKey) — полный URL навешивает
 * CategoriesService.withIconUrl ПОСЛЕ cache.wrap, как у медиа каталога.
 */
export interface CategoryResponse {
  id: string;
  name: string;
  /** Стабильный ключ категории товаров (houseplants); у подкатегорий null. */
  code: string | null;
  /** null — категория товаров (верхний уровень), иначе подкатегория. */
  parentId: string | null;
  iconUrl: string | null;
  position: number;
  sellerId: string | null;
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Админка: то же + все переводы для формы редактирования. */
export interface AdminCategoryResponse extends CategoryResponse {
  translations: { locale: Locale; name: string; auto: boolean }[];
  /** Сколько позиций каталога привязано к категории (на её уровне). */
  itemsCount: number;
  /** Сколько подкатегорий у категории верхнего уровня. */
  childrenCount: number;
}

/** Ссылка на категорию внутри позиции каталога/листинга — без иконки и ревью. */
export interface CategoryRef {
  id: string;
  code: string | null;
  name: string;
}

type CategoryWithNames = Prisma.CategoryGetPayload<{
  include: { translations: true };
}>;

export const toCategoryResponse = (
  c: CategoryWithNames,
  locale: Locale,
): CategoryResponse => ({
  id: c.id,
  name: pickTranslation(c.translations, locale).name,
  code: c.code,
  parentId: c.parentId,
  iconUrl: c.iconKey,
  position: c.position,
  sellerId: c.sellerId,
  status: c.status,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export const toCategoryRef = (
  c: CategoryWithNames,
  locale: Locale,
): CategoryRef => ({
  id: c.id,
  code: c.code,
  name: pickTranslation(c.translations, locale).name,
});

export const toAdminCategoryResponse = (
  c: CategoryWithTranslations,
): AdminCategoryResponse => ({
  ...toCategoryResponse(c, DEFAULT_LOCALE),
  itemsCount: c._count.catalogItems + c._count.subcatalogItems,
  childrenCount: c._count.children,
  translations: SUPPORTED_LOCALES.map((locale) => {
    const t = pickTranslation(c.translations, locale);
    return { locale, name: t.name, auto: t.auto };
  }),
});
