import { Locale, Prisma } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';

export type CountryWithTranslations = Prisma.CountryGetPayload<{
  include: { translations: true; _count: { select: { catalogItems: true } } };
}>;

/** Мобилка: плоское резолвленное имя, ни одной локали в контракте. */
export interface CountryResponse {
  id: string;
  code: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Админка: то же + все переводы для формы редактирования. */
export interface AdminCountryResponse extends CountryResponse {
  translations: { locale: Locale; name: string; auto: boolean }[];
  /** Сколько позиций каталога ссылается на страну. */
  itemsCount: number;
}

// Вызывается из мэппера каталога, где _count не грузится — первый аргумент
// именно Omit<..., '_count'>, как у toCategoryResponse.
export const toCountryResponse = (
  c: Omit<CountryWithTranslations, '_count'>,
  locale: Locale,
): CountryResponse => ({
  id: c.id,
  code: c.code,
  name: pickTranslation(c.translations, locale).name,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export const toAdminCountryResponse = (
  c: CountryWithTranslations,
): AdminCountryResponse => ({
  ...toCountryResponse(c, DEFAULT_LOCALE),
  itemsCount: c._count.catalogItems,
  translations: SUPPORTED_LOCALES.map((locale) => {
    const t = pickTranslation(c.translations, locale);
    return { locale, name: t.name, auto: t.auto };
  }),
});
