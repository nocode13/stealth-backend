import { Locale } from '@prisma/client';

export const SUPPORTED_LOCALES: Locale[] = [Locale.RU, Locale.UZ, Locale.EN];
export const DEFAULT_LOCALE: Locale = Locale.RU;

// Клиент шлёт обычный BCP-47 тег ('ru', 'uz-Latn-UZ', 'en-US') — сопоставляем по
// первичному сабтегу.
const LOCALE_BY_TAG: Record<string, Locale> = {
  ru: Locale.RU,
  uz: Locale.UZ,
  en: Locale.EN,
};

/** 'uz-UZ,uz;q=0.9,ru;q=0.8' → Locale.UZ. Всё незнакомое и пустое → DEFAULT_LOCALE. */
export function parseAcceptLanguage(header?: string): Locale {
  if (!header) return DEFAULT_LOCALE;
  const entries = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        tag: tag.trim().toLowerCase(),
        q: q ? Number(q.trim().slice(2)) : 1,
      };
    })
    .filter((e) => e.tag && !Number.isNaN(e.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const locale = LOCALE_BY_TAG[tag.split('-')[0]];
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
