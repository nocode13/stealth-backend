import { BadRequestException } from '@nestjs/common';
import { Locale } from '@prisma/client';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locale';

const clean = (v?: string | null): string | null => {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Раскладывает присланные админкой переводы по ВСЕМ локалям (инвариант И1):
 * пустые заполняются значением DEFAULT_LOCALE и помечаются auto: true.
 * RU обязателен — это фолбэк для всех остальных.
 */
export function normalizeCategoryTranslations(
  input: { locale: Locale; name?: string }[],
): { locale: Locale; name: string; auto: boolean }[] {
  const byLocale = new Map(input.map((t) => [t.locale, t]));
  const base = clean(byLocale.get(DEFAULT_LOCALE)?.name);
  if (!base) throw new BadRequestException('Название на русском обязательно');

  return SUPPORTED_LOCALES.map((locale) => {
    const name = clean(byLocale.get(locale)?.name);
    return { locale, name: name ?? base, auto: name === null };
  });
}

export function normalizeCatalogTranslations(
  input: {
    locale: Locale;
    name?: string;
    description?: string | null;
    unit?: string;
  }[],
): {
  locale: Locale;
  name: string;
  description: string | null;
  unit: string;
  auto: boolean;
}[] {
  const byLocale = new Map(input.map((t) => [t.locale, t]));
  const ru = byLocale.get(DEFAULT_LOCALE);
  const baseName = clean(ru?.name);
  if (!baseName)
    throw new BadRequestException('Название на русском обязательно');
  const baseDescription = clean(ru?.description);
  const baseUnit = clean(ru?.unit) ?? 'шт';

  return SUPPORTED_LOCALES.map((locale) => {
    const t = byLocale.get(locale);
    const name = clean(t?.name);
    return {
      locale,
      name: name ?? baseName,
      description: clean(t?.description) ?? baseDescription,
      unit: clean(t?.unit) ?? baseUnit,
      auto: name === null,
    };
  });
}

export function normalizeSellerTranslations(
  input: { locale: Locale; name?: string; description?: string | null }[],
): {
  locale: Locale;
  name: string;
  description: string | null;
  auto: boolean;
}[] {
  const byLocale = new Map(input.map((t) => [t.locale, t]));
  const ru = byLocale.get(DEFAULT_LOCALE);
  const baseName = clean(ru?.name);
  if (!baseName)
    throw new BadRequestException('Название на русском обязательно');
  const baseDescription = clean(ru?.description);

  return SUPPORTED_LOCALES.map((locale) => {
    const t = byLocale.get(locale);
    const name = clean(t?.name);
    return {
      locale,
      name: name ?? baseName,
      description: clean(t?.description) ?? baseDescription,
      auto: name === null,
    };
  });
}
