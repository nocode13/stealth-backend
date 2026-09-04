import { Locale, Prisma, ReviewStatus } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';

export type CategoryWithTranslations = Prisma.CategoryGetPayload<{
  include: { translations: true };
}>;

/** Мобилка: плоское резолвленное имя, ни одной локали в контракте. */
export interface CategoryResponse {
  id: string;
  name: string;
  sellerId: string | null;
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Админка: то же + все переводы для формы редактирования. */
export interface AdminCategoryResponse extends CategoryResponse {
  translations: { locale: Locale; name: string; auto: boolean }[];
}

export const toCategoryResponse = (
  c: CategoryWithTranslations,
  locale: Locale,
): CategoryResponse => ({
  id: c.id,
  name: pickTranslation(c.translations, locale).name,
  sellerId: c.sellerId,
  status: c.status,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export const toAdminCategoryResponse = (
  c: CategoryWithTranslations,
): AdminCategoryResponse => ({
  ...toCategoryResponse(c, DEFAULT_LOCALE),
  translations: SUPPORTED_LOCALES.map((locale) => {
    const t = pickTranslation(c.translations, locale);
    return { locale, name: t.name, auto: t.auto };
  }),
});
