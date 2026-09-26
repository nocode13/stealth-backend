import { PriceRuleAction } from '@prisma/client';
import type { PriceRule } from '@prisma/client';

// Движок цены — чистые функции без I/O: всё нужное (листинг, настройки, правила,
// акции, «сейчас») приходит аргументами, поэтому его можно гонять в тестах и на любом
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

/**
 * Акция, в которой состоит листинг. discountBps уже эффективный:
 * PromotionItem.discountBps ?? Promotion.discountBps.
 */
export interface PromotionCandidate {
  promotionId: string;
  discountBps: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface ResolvedPrice {
  /** Итоговая розница — с акцией, если она сработала. */
  price: number;
  /** Розница без акции (зачёркнутая «было»); null — акции нет. */
  oldPrice: number | null;
  /** null — акции нет. */
  promotionId: string | null;
  /** null — сработала базовая наценка. */
  appliedRuleId: string | null;
  ruleName: string | null;
  /** Базовая наценка на момент расчёта — для снапшота в заказ. */
  markupBps: number;
}

// Вверх, как и roundUp: доли тийина всегда в пользу платформы. На этом держится
// бэкфилл миграции 20260924120000_pricing: costPrice = FLOOR(price / 1.2) при
// наценке 20% возвращает ровно прежнюю price.
const applyBps = (amount: number, bps: number) =>
  Math.ceil((amount * (BPS + bps)) / BPS);

const roundUp = (amount: number, step: number) =>
  step > 1 ? Math.ceil(amount / step) * step : amount;

/** Окно дат [startsAt, endsAt); null — без ограничения с этой стороны. */
export function isInWindow(
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): boolean {
  if (startsAt !== null && now < startsAt) return false;
  if (endsAt !== null && now >= endsAt) return false;
  return true;
}

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
  if (!isInWindow(rule.startsAt, rule.endsAt, now)) return false;
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
 * Обычная розница листинга (без акций). Из подходящих правил применяется одно — с
 * наибольшим priority, при равенстве — дающее меньшую цену. Не подошло ни одно —
 * базовая наценка. Результат округляется вверх до шага и никогда не опускается
 * ниже себестоимости: продавать в минус движок не умеет by design.
 */
function resolveRegularPrice(
  target: PriceTarget,
  config: PriceConfig,
  rules: PriceRuleInput[],
  now: Date,
): { price: number; rule: PriceRuleInput | null } {
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
  return {
    price: Math.max(roundUp(raw, config.roundingStep), target.costPrice),
    rule: best?.rule ?? null,
  };
}

/**
 * Итоговая розничная цена листинга — два этапа:
 * 1. обычная розница (правила/наценка, см. resolveRegularPrice);
 * 2. акция поверх неё: из акций листинга в окне дат берётся дающая наименьшую цену
 *    (при равенстве — с меньшим id, чтобы результат был детерминирован). Скидка
 *    считается от обычной розницы, округляется вверх и упирается в costPrice —
 *    скидку оплачивает маржа платформы, не продавец.
 * Если акционная цена не ниже обычной (уперлась в себестоимость), акция НЕ
 * применяется: зачёркивать «было» при той же цене — фейковая скидка.
 */
export function resolvePrice(
  target: PriceTarget,
  config: PriceConfig,
  rules: PriceRuleInput[],
  promotions: PromotionCandidate[],
  now: Date,
): ResolvedPrice {
  const regular = resolveRegularPrice(target, config, rules, now);

  let promo: { promotionId: string; price: number } | null = null;
  for (const p of promotions) {
    if (!isInWindow(p.startsAt, p.endsAt, now)) continue;
    const price = Math.max(
      roundUp(applyBps(regular.price, -p.discountBps), config.roundingStep),
      target.costPrice,
    );
    if (
      promo === null ||
      price < promo.price ||
      (price === promo.price && p.promotionId < promo.promotionId)
    ) {
      promo = { promotionId: p.promotionId, price };
    }
  }
  const applied = promo !== null && promo.price < regular.price ? promo : null;

  return {
    price: applied ? applied.price : regular.price,
    oldPrice: applied ? regular.price : null,
    promotionId: applied ? applied.promotionId : null,
    appliedRuleId: regular.rule?.id ?? null,
    ruleName: regular.rule?.name ?? null,
    markupBps: config.markupBps,
  };
}
