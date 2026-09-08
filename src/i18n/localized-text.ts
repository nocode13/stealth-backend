import { Locale, Prisma } from '@prisma/client';
import { DEFAULT_LOCALE } from './locale';

export type LocalizedText = Record<string, string>;

/** [{locale:'RU',name:'Роза'},…] + 'name' → { RU:'Роза', UZ:'Atirgul', EN:'Rose' } */
export function toLocalizedText<T extends { locale: Locale }>(
  rows: T[],
  field: keyof T,
): LocalizedText {
  return Object.fromEntries(
    rows.map((r) => [r.locale, String(r[field] ?? '')]),
  );
}

/** Читает снапшот. Строку (значение до миграции) отдаёт как есть. */
export function pickText(
  value: Prisma.JsonValue | null | undefined,
  locale: Locale,
): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const map = value as Record<string, unknown>;
  const raw = map[locale] ?? map[DEFAULT_LOCALE] ?? Object.values(map)[0];
  return typeof raw === 'string' ? raw : '';
}
