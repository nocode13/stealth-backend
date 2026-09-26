// Даты акций и правил цены — с точностью до дня: админ выбирает день начала и
// последний день (включительно), цена по датам меняется только в 00:00 по Ташкенту.
// В БД (startsAt/endsAt) всегда лежит ровно полночь, endsAt — исключающая граница:
// начало дня ПОСЛЕ последнего. Движок (isInWindow) о днях не знает и сравнивает
// моменты как раньше.
//
// Узбекистан живёт в UTC+5 без перехода на летнее время, поэтому хватает фиксированного
// смещения — таймзонной библиотеки не нужно.

/** Смещение бизнес-таймзоны (Asia/Tashkent) от UTC. */
export const BUSINESS_UTC_OFFSET = '+05:00';
const OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` — формат дня в API (DTO и ответы). */
export const BUSINESS_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 00:00 по Ташкенту дня `day` (`YYYY-MM-DD`) — это startsAt. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00${BUSINESS_UTC_OFFSET}`);
}

/** 00:00 по Ташкенту дня ПОСЛЕ `day` — это endsAt: `day` действует целиком. */
export function dayEndExclusive(day: string): Date {
  return new Date(dayStart(day).getTime() + DAY_MS);
}

/** День (`YYYY-MM-DD`) по Ташкенту, в который попадает момент `date`. */
export function toBusinessDay(date: Date): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** startsAt → день начала; null остаётся null. */
export const toStartDay = (startsAt: Date | null): string | null =>
  startsAt ? toBusinessDay(startsAt) : null;

/** endsAt (исключающая полночь) → последний день действия включительно. */
export const toEndDay = (endsAt: Date | null): string | null =>
  endsAt ? toBusinessDay(new Date(endsAt.getTime() - 1)) : null;

/** Ближайшая полночь по Ташкенту строго после `now`. */
export function nextBusinessMidnight(now: Date): Date {
  return dayEndExclusive(toBusinessDay(now));
}

/**
 * Настоящий ли это день календаря: регэксп пропустит `2026-02-31`, а Date молча
 * перенесёт его на 3 марта — сверяемся с обратным преобразованием.
 */
export function isBusinessDay(day: string): boolean {
  if (!BUSINESS_DAY_PATTERN.test(day)) return false;
  const start = dayStart(day);
  return !Number.isNaN(start.getTime()) && toBusinessDay(start) === day;
}
