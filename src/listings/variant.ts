import type { Prisma } from '@prisma/client';

/**
 * Атрибуты варианта листинга — единственное место, которое знает их набор.
 *
 * Листинг — вариант товара (позиции каталога): росток, горшок 3 л, 5 стеблей,
 * 60 см. Клиентам атрибуты уходят СЫРЫМИ (и в ответе листинга, и в снапшоте заказа)
 * — подпись на своём языке собирают мобилка и админка. Сервер форматирует только
 * для Telegram (`formatVariantRu`): у сообщения в боте нет клиента.
 *
 * Новый атрибут = колонка в схеме + поле здесь + DTO + форматеры в клиентах.
 */
// type, а не interface: пишется в Json-колонку (OrderItem.variant), а interface
// не приводится к индексной сигнатуре Prisma.InputJsonObject.
export type VariantFields = {
  seedling: boolean;
  potVolumeMl: number | null;
  stemCount: number | null;
  heightCm: number | null;
};

export const pickVariant = (l: VariantFields): VariantFields => ({
  seedling: l.seedling,
  potVolumeMl: l.potVolumeMl,
  stemCount: l.stemCount,
  heightCm: l.heightCm,
});

/**
 * Порядок вариантов в чипах карточки: ростки первыми, дальше по размеру.
 * nulls last — вариант без атрибута стоит после указанных.
 */
export const VARIANT_ORDER_BY: Prisma.ListingOrderByWithRelationInput[] = [
  { seedling: 'desc' },
  { potVolumeMl: { sort: 'asc', nulls: 'last' } },
  { heightCm: { sort: 'asc', nulls: 'last' } },
  { stemCount: { sort: 'asc', nulls: 'last' } },
  { id: 'asc' },
];

const formatLiters = (ml: number): string =>
  (ml / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** «росток · 3 л · 5 стеблей · 60 см»; null — атрибутов нет. Только для бота. */
export function formatVariantRu(v: VariantFields | null): string | null {
  if (!v) return null;
  const parts = [
    v.seedling ? 'росток' : null,
    v.potVolumeMl !== null ? `${formatLiters(v.potVolumeMl)} л` : null,
    v.stemCount !== null ? `${v.stemCount} ${stemsRu(v.stemCount)}` : null,
    v.heightCm !== null ? `${v.heightCm} см` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ') : null;
}

function stemsRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'стебель';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'стебля';
  }
  return 'стеблей';
}

/**
 * OrderItem.variant — JSON-снапшот; у заказов до вариантов там null. Разбор без
 * доверия к форме: колонка Json, тип ей гарантирует только код записи.
 */
export function variantFromSnapshot(value: unknown): VariantFields | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown): number | null => (typeof x === 'number' ? x : null);
  return {
    seedling: v.seedling === true,
    potVolumeMl: num(v.potVolumeMl),
    stemCount: num(v.stemCount),
    heightCm: num(v.heightCm),
  };
}
