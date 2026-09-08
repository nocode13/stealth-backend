import { Locale } from '@prisma/client';
import { DEFAULT_LOCALE } from './locale';

/**
 * Выбирает строку перевода под локаль. По инварианту И1 строка есть всегда;
 * фолбэки ниже — страховка для строк, записанных до добавления новой локали.
 */
export function pickTranslation<T extends { locale: Locale }>(
  rows: T[] | undefined,
  locale: Locale,
): T {
  const row =
    rows?.find((r) => r.locale === locale) ??
    rows?.find((r) => r.locale === DEFAULT_LOCALE) ??
    rows?.[0];
  if (!row) {
    // Почти всегда означает забытый `include: { translations: true }`.
    throw new Error('pickTranslation: переводы не загружены');
  }
  return row;
}
