import { Locale, Prisma, SellerStatus } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/locale';

export type SellerWithTranslations = Prisma.SellerGetPayload<{
  include: { translations: true };
}>;

/** Мобилка: плоские резолвленные name/description, ни одной локали в контракте. */
export interface SellerResponse {
  id: string;
  name: string;
  description: string | null;
  bannerUrl: string | null;
  status: SellerStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Админка: то же + owner + все переводы для формы редактирования. */
export interface AdminSellerResponse extends SellerResponse {
  ownerUserId: string;
  translations: {
    locale: Locale;
    name: string;
    description: string | null;
    auto: boolean;
  }[];
}

export const toSellerResponse = (
  s: SellerWithTranslations,
  locale: Locale,
): SellerResponse => {
  const t = pickTranslation(s.translations, locale);
  return {
    id: s.id,
    name: t.name,
    description: t.description,
    bannerUrl: s.bannerUrl,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
};

export const toAdminSellerResponse = (
  s: SellerWithTranslations,
): AdminSellerResponse => ({
  ...toSellerResponse(s, DEFAULT_LOCALE),
  ownerUserId: s.ownerUserId,
  translations: SUPPORTED_LOCALES.map((locale) => {
    const t = pickTranslation(s.translations, locale);
    return { locale, name: t.name, description: t.description, auto: t.auto };
  }),
});
