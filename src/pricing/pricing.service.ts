import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PlatformSettings, PriceRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SettingsService } from '../settings/settings.service';
import { UpdatePlatformSettingsDto } from '../settings/dto/settings.dto';
import { PriceConfig, PromotionCandidate, resolvePrice } from './price-engine';

type Db = PrismaService | Prisma.TransactionClient;

// Сколько листингов читаем за проход и сколько строк кладём в один UPDATE.
// Пересчёт всей витрины (смена наценки) идёт кусками, а не одним findMany.
const PAGE_SIZE = 1000;
const UPDATE_CHUNK = 500;

/**
 * Листинги, которых может коснуться правило: его область (listingId/sellerId/
 * catalogItemId/categoryId, И по заданным). Условия (даты, остаток) сюда не входят —
 * их проверяет движок, а пересчитать надо и тех, кто из-под правила выпал.
 */
export function ruleScopeWhere(
  rule: Pick<
    PriceRule,
    'listingId' | 'sellerId' | 'catalogItemId' | 'categoryId'
  >,
): Prisma.ListingWhereInput {
  return {
    id: rule.listingId ?? undefined,
    sellerId: rule.sellerId ?? undefined,
    catalogItemId: rule.catalogItemId ?? undefined,
    catalogItem: rule.categoryId ? { categoryId: rule.categoryId } : undefined,
  };
}

/**
 * Единственное место, которое пишет Listing.price (и oldPrice/promotionId/onPromo —
 * результат акции). Розница денормализована: считается при записи (листинг,
 * настройки, остаток, правила, акции, полночь для датированных), а не при чтении — поэтому
 * витрина сортирует и фильтрует по цене в БД, а кэш и мобилка её не замечают.
 *
 * ⚠️ cache.bump() делает вызывающий и строго после коммита — как везде в проекте.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
  ) {}

  /**
   * PATCH /admin/settings. Живёт здесь, а не в SettingsService: смена наценки или
   * округления обязана пересчитать всю витрину, а SettingsModule не знает о
   * ценообразовании (иначе цикл модулей).
   */
  async updateSettings(
    dto: UpdatePlatformSettingsDto,
  ): Promise<PlatformSettings> {
    const updated = await this.settings.update(dto);
    if (dto.markupBps !== undefined || dto.priceRoundingStep !== undefined) {
      // Второй bump обязателен: между первым (в settings.update) и концом пересчёта
      // витрина успела бы закэшироваться со старыми ценами.
      if ((await this.recalculate({})) > 0) await this.cache.bump();
    }
    return updated;
  }

  async config(): Promise<PriceConfig> {
    const s = await this.settings.get();
    return { markupBps: s.markupBps, roundingStep: s.priceRoundingStep };
  }

  /**
   * Пересчитывает розницу листингов под `where` (пустой объект — все) и пишет только
   * изменившиеся строки. Возвращает число изменённых листингов. `tx` — чтобы
   * пересчитать в той же транзакции, что и запись costPrice/stock.
   */
  async recalculate(
    where: Prisma.ListingWhereInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db: Db = tx ?? this.prisma;
    const now = new Date();
    const [config, rules, promotions] = await Promise.all([
      this.config(),
      db.priceRule.findMany({ where: { enabled: true } }),
      this.loadPromotions(db, now),
    ]);

    let changed = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await db.listing.findMany({
        where,
        select: {
          id: true,
          sellerId: true,
          catalogItemId: true,
          costPrice: true,
          stock: true,
          price: true,
          appliedRuleId: true,
          oldPrice: true,
          promotionId: true,
          catalogItem: { select: { categoryId: true } },
        },
        orderBy: { id: 'asc' },
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        take: PAGE_SIZE,
      });
      if (page.length === 0) break;

      const updates = page.flatMap((l) => {
        const resolved = resolvePrice(
          {
            listingId: l.id,
            sellerId: l.sellerId,
            catalogItemId: l.catalogItemId,
            categoryId: l.catalogItem.categoryId,
            costPrice: l.costPrice,
            stock: l.stock,
          },
          config,
          rules,
          promotions.get(l.id) ?? [],
          now,
        );
        return resolved.price === l.price &&
          resolved.appliedRuleId === l.appliedRuleId &&
          resolved.oldPrice === l.oldPrice &&
          resolved.promotionId === l.promotionId
          ? []
          : [{ id: l.id, ...resolved }];
      });

      for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
        const chunk = updates.slice(i, i + UPDATE_CHUNK);
        await db.$executeRaw`
          UPDATE "listings" AS l
          SET "price" = v.price,
              "appliedRuleId" = v.rule_id,
              "oldPrice" = v.old_price,
              "promotionId" = v.promotion_id,
              "onPromo" = v.promotion_id IS NOT NULL
          FROM (VALUES ${Prisma.join(
            chunk.map(
              (u) =>
                Prisma.sql`(${u.id}::text, ${u.price}::int, ${u.appliedRuleId}::text, ${u.oldPrice}::int, ${u.promotionId}::text)`,
            ),
          )}) AS v(id, price, rule_id, old_price, promotion_id)
          WHERE l.id = v.id
        `;
      }
      changed += updates.length;

      if (page.length < PAGE_SIZE) break;
      cursor = page[page.length - 1].id;
    }
    return changed;
  }

  /**
   * Акции по листингам: включённые и ещё не закончившиеся (будущие тоже — окно дат
   * проверяет движок). Акций и позиций в них немного, поэтому грузим разом, а не
   * по странице листингов.
   */
  private async loadPromotions(
    db: Db,
    now: Date,
  ): Promise<Map<string, PromotionCandidate[]>> {
    const items = await db.promotionItem.findMany({
      where: {
        promotion: {
          enabled: true,
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
      select: {
        listingId: true,
        discountBps: true,
        promotion: {
          select: { id: true, discountBps: true, startsAt: true, endsAt: true },
        },
      },
    });
    const byListing = new Map<string, PromotionCandidate[]>();
    for (const item of items) {
      const list = byListing.get(item.listingId) ?? [];
      list.push({
        promotionId: item.promotion.id,
        discountBps: item.discountBps ?? item.promotion.discountBps,
        startsAt: item.promotion.startsAt,
        endsAt: item.promotion.endsAt,
      });
      byListing.set(item.listingId, list);
    }
    return byListing;
  }
}
