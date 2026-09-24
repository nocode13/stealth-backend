import { PriceRuleAction } from '@prisma/client';
import type { PriceRule } from '@prisma/client';

// Движок цены — чистые функции без I/O: всё нужное (листинг, настройки, правила,
// «сейчас») приходит аргументами, поэтому его можно гонять в тестах и на любом
// объёме данных. Писать результат в БД — дело PricingService.
//
// Вся арифметика целочисленная: деньги в тийинах, проценты в базисных пунктах
// (1% = 100 bps). Float в деньгах дал бы 12 000,000000001.

const BPS = 10_000;

/** То, что движку нужно знать о листинге. */
export interface PriceTarget {
  listingId: string;
  sellerId: string;
  catalogItemId: string;
  categoryId: string | null;
  costPrice: number;
  stock: number;
}

export interface PriceConfig {
  /** Базовая наценка платформы, bps. */
  markupBps: number;
  /** Шаг округления вверх, тийины. */
  roundingStep: number;
}

export type PriceRuleInput = Pick<
  PriceRule,
  | 'id'
  | 'name'
  | 'enabled'
  | 'priority'
  | 'action'
  | 'value'
  | 'sellerId'
  | 'categoryId'
  | 'catalogItemId'
  | 'listingId'
  | 'startsAt'
  | 'endsAt'
  | 'minStock'
  | 'maxStock'
>;

export interface ResolvedPrice {
  price: number;
  /** null — сработала базовая наценка. */
  appliedRuleId: string | null;
  ruleName: string | null;
  /** Базовая наценка на момент расчёта — для снапшота в заказ. */
  markupBps: number;
}

// Вверх, как и roundUp: доли тийина всегда в пользу платформы, и результат
// совпадает с SQL-бэкфиллом миграции 20260924120000_pricing (CEIL).
const applyBps = (amount: number, bps: number) =>
  Math.ceil((amount * (BPS + bps)) / BPS);

const roundUp = (amount: number, step: number) =>
  step > 1 ? Math.ceil(amount / step) * step : amount;

/** Подходит ли правило под листинг: область (И по всем заданным полям) + условия. */
export function matchesRule(
  rule: PriceRuleInput,
  target: PriceTarget,
  now: Date,
): boolean {
  if (!rule.enabled) return false;
  if (rule.listingId !== null && rule.listingId !== target.listingId) {
    return false;
  }
  if (rule.sellerId !== null && rule.sellerId !== target.sellerId) return false;
  if (
    rule.catalogItemId !== null &&
    rule.catalogItemId !== target.catalogItemId
  ) {
    return false;
  }
  if (rule.categoryId !== null && rule.categoryId !== target.categoryId) {
    return false;
  }
  if (rule.startsAt !== null && now < rule.startsAt) return false;
  if (rule.endsAt !== null && now >= rule.endsAt) return false;
  if (rule.minStock !== null && target.stock < rule.minStock) return false;
  if (rule.maxStock !== null && target.stock > rule.maxStock) return false;
  return true;
}

/**
 * Цена-кандидат одного правила, до округления и пола. Новый тип правила — новое
 * значение PriceRuleAction и ветка здесь; остальной конвейер не меняется.
 */
export function applyAction(
  rule: Pick<PriceRuleInput, 'action' | 'value'>,
  costPrice: number,
  config: PriceConfig,
): number {
  switch (rule.action) {
    case PriceRuleAction.MARKUP_PERCENT:
      return applyBps(costPrice, rule.value);
    case PriceRuleAction.DISCOUNT_PERCENT:
      return applyBps(applyBps(costPrice, config.markupBps), -rule.value);
    case PriceRuleAction.FIXED_PRICE:
      return rule.value;
  }
}

/**
 * Итоговая розничная цена листинга. Из подходящих правил применяется одно — с
 * наибольшим priority, при равенстве — дающее меньшую цену. Не подошло ни одно —
 * базовая наценка. Результат округляется вверх до шага и никогда не опускается
 * ниже себестоимости: продавать в минус движок не умеет by design.
 */
export function resolvePrice(
  target: PriceTarget,
  config: PriceConfig,
  rules: PriceRuleInput[],
  now: Date,
): ResolvedPrice {
  let best: { rule: PriceRuleInput; price: number } | null = null;
  for (const rule of rules) {
    if (!matchesRule(rule, target, now)) continue;
    const price = applyAction(rule, target.costPrice, config);
    if (
      best === null ||
      rule.priority > best.rule.priority ||
      (rule.priority === best.rule.priority && price < best.price)
    ) {
      best = { rule, price };
    }
  }

  const raw = best ? best.price : applyBps(target.costPrice, config.markupBps);
  const price = Math.max(roundUp(raw, config.roundingStep), target.costPrice);

  return {
    price,
    appliedRuleId: best?.rule.id ?? null,
    ruleName: best?.rule.name ?? null,
    markupBps: config.markupBps,
  };
}
