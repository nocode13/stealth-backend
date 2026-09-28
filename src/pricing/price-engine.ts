import { PriceSource } from '@prisma/client';

// Движок цены — чистые функции без I/O: всё нужное (листинг, настройки, акции,
// «сейчас») приходит аргументами, поэтому его можно гонять в тестах и на любом
// объёме данных. Писать результат в БД — дело PricingService.
//
// Вся арифметика целочисленная: деньги в тийинах, проценты в базисных пунктах
// (1% = 100 bps). Float в деньгах дал бы 12 000,000000001.

const BPS = 10_000;

/** То, что движку нужно знать о листинге. */
export interface PriceTarget {
  costPrice: number;
  /** Своя наценка листинга, bps; null — базовая ступенчатая. */
  customMarkupBps: number | null;
}

/** Ступень базовой наценки: от minCost (тийины, включительно) до следующей ступени. */
export interface MarkupTierInput {
  minCost: number;
  markupBps: number;
}

export interface PriceConfig {
  /** Ступени базовой наценки по возрастанию minCost, первая — с 0. */
  markupTiers: MarkupTierInput[];
  /** Шаг округления вверх, тийины. */
  roundingStep: number;
  /** Порядок источников цены: срабатывает первый подходящий. */
  order: PriceSource[];
}

/** Акция, в которой состоит листинг, с его фиксированной ценой по ней. */
export interface PromotionCandidate {
  promotionId: string;
  promoPrice: number;
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
  /** Какой источник дал цену. */
  source: PriceSource;
  /** Наценка обычной розницы (своя или ступени) — для снапшота в заказ. */
  markupBps: number;
}

/** Порядок источников по умолчанию — он же в миграции 20260927120000_price_sources. */
export const DEFAULT_PRICE_ORDER: PriceSource[] = [
  PriceSource.PROMOTION,
  PriceSource.LISTING_MARKUP,
  PriceSource.BASE_MARKUP,
];

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

/**
 * Базовая ступенчатая наценка, до округления. Вся себестоимость берётся под процент
 * своей ступени, но цена не опускается ниже максимума предыдущих ступеней: иначе у
 * границы «до 50 000 → 60%, дальше 40%» товар за 51 000 стоил бы на витрине дешевле
 * товара за 50 000. Возвращает и процент ступени — для снапшота в заказ.
 */
export function baseMarkup(
  costPrice: number,
  tiers: MarkupTierInput[],
): { price: number; markupBps: number } {
  if (tiers.length === 0) return { price: costPrice, markupBps: 0 };
  let floor = 0;
  let tier = tiers[0];
  for (let i = 1; i < tiers.length && tiers[i].minCost <= costPrice; i++) {
    // Максимум предыдущей ступени — её цена на последнем тийине перед границей.
    floor = Math.max(floor, applyBps(tiers[i].minCost - 1, tier.markupBps));
    tier = tiers[i];
  }
  return {
    price: Math.max(applyBps(costPrice, tier.markupBps), floor),
    markupBps: tier.markupBps,
  };
}

/**
 * Обычная розница листинга (без акции): своя наценка, если задана, иначе ступенчатая.
 * Округляется вверх до шага и никогда не опускается ниже себестоимости.
 */
function regularPrice(
  target: PriceTarget,
  config: PriceConfig,
  custom: boolean,
): { price: number; markupBps: number } {
  const raw =
    custom && target.customMarkupBps !== null
      ? {
          price: applyBps(target.costPrice, target.customMarkupBps),
          markupBps: target.customMarkupBps,
        }
      : baseMarkup(target.costPrice, config.markupTiers);
  return {
    price: Math.max(roundUp(raw.price, config.roundingStep), target.costPrice),
    markupBps: raw.markupBps,
  };
}

/**
 * Лучшая акция листинга на сейчас: из акций в окне дат — дающая наименьшую цену (при
 * равенстве — с меньшим id, чтобы результат был детерминирован). Цена по акции
 * фиксированная, без округления (её ввёл админ), но не ниже себестоимости — скидку
 * оплачивает маржа платформы, не продавец.
 */
function bestPromotion(
  target: PriceTarget,
  promotions: PromotionCandidate[],
  now: Date,
): { promotionId: string; price: number } | null {
  let best: { promotionId: string; price: number } | null = null;
  for (const p of promotions) {
    if (!isInWindow(p.startsAt, p.endsAt, now)) continue;
    const price = Math.max(p.promoPrice, target.costPrice);
    if (
      best === null ||
      price < best.price ||
      (price === best.price && p.promotionId < best.promotionId)
    ) {
      best = { promotionId: p.promotionId, price };
    }
  }
  return best;
}

/**
 * Итоговая розничная цена листинга. Источники пробуются в порядке `config.order`,
 * срабатывает первый подходящий:
 * - PROMOTION — есть акция в окне дат и её цена ниже обычной розницы. «Было» — обычная
 *   розница (своя наценка, если задана, иначе ступенчатая). Если акционная цена не ниже
 *   обычной, акция НЕ применяется: зачёркивать «было» при той же цене — фейковая скидка;
 * - LISTING_MARKUP — у листинга задана своя наценка;
 * - BASE_MARKUP — ступенчатая наценка платформы, подходит всегда.
 */
export function resolvePrice(
  target: PriceTarget,
  config: PriceConfig,
  promotions: PromotionCandidate[],
  now: Date,
): ResolvedPrice {
  const regular = regularPrice(target, config, true);

  for (const source of config.order) {
    switch (source) {
      case PriceSource.PROMOTION: {
        const promo = bestPromotion(target, promotions, now);
        if (promo !== null && promo.price < regular.price) {
          return {
            price: promo.price,
            oldPrice: regular.price,
            promotionId: promo.promotionId,
            source,
            markupBps: regular.markupBps,
          };
        }
        break;
      }
      case PriceSource.LISTING_MARKUP:
        if (target.customMarkupBps !== null) {
          return {
            price: regular.price,
            oldPrice: null,
            promotionId: null,
            source,
            markupBps: regular.markupBps,
          };
        }
        break;
      case PriceSource.BASE_MARKUP: {
        const base = regularPrice(target, config, false);
        return {
          price: base.price,
          oldPrice: null,
          promotionId: null,
          source,
          markupBps: base.markupBps,
        };
      }
    }
  }

  // Порядок без BASE_MARKUP (не должно случаться: его держит PricingService).
  const base = regularPrice(target, config, false);
  return {
    price: base.price,
    oldPrice: null,
    promotionId: null,
    source: PriceSource.BASE_MARKUP,
    markupBps: base.markupBps,
  };
}
