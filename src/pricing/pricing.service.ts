import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PriceSource } from '@prisma/client';
import type { PlatformSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SettingsService } from '../settings/settings.service';
import {
  MarkupTierDto,
  UpdatePlatformSettingsDto,
} from '../settings/dto/settings.dto';
import {
  DEFAULT_PRICE_ORDER,
  MarkupTierInput,
  PriceConfig,
  PromotionCandidate,
  resolvePrice,
} from './price-engine';

type Db = PrismaService | Prisma.TransactionClient;

// Сколько листингов читаем за проход и сколько строк кладём в один UPDATE.
// Пересчёт всей витрины (смена наценки) идёт кусками, а не одним findMany.
const PAGE_SIZE = 1000;
const UPDATE_CHUNK = 500;
const MAX_TIERS = 20;

/** Ответ admin/settings: синглтон настроек + ступени базовой наценки. */
export type AdminSettingsResponse = PlatformSettings & {
  markupTiers: MarkupTierInput[];
};

/**
 * Единственное место, которое пишет Listing.price (и oldPrice/promotionId/onPromo/
 * priceSource — результат движка). Розница денормализована: считается при записи
 * (листинг, настройки, ступени, приоритеты, акции, полночь для датированных), а не при
 * чтении — поэтому витрина сортирует и фильтрует по цене в БД, а кэш и мобилка её не
 * замечают.
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

  async getSettings(): Promise<AdminSettingsResponse> {
    const [settings, markupTiers] = await Promise.all([
      this.settings.get(),
      this.loadTiers(this.prisma),
    ]);
    return { ...settings, markupTiers };
  }

  /**
   * PATCH /admin/settings. Живёт здесь, а не в SettingsService: смена ступеней наценки
   * или округления обязана пересчитать всю витрину, а SettingsModule не знает о
   * ценообразовании (иначе цикл модулей). Ступени приходят набором и заменяют прежний
   * целиком.
   */
  async updateSettings(
    dto: UpdatePlatformSettingsDto,
  ): Promise<AdminSettingsResponse> {
    const { markupTiers, ...rest } = dto;
    if (markupTiers !== undefined) {
      validateTiers(markupTiers);
      await this.prisma.$transaction([
        this.prisma.markupTier.deleteMany(),
        this.prisma.markupTier.createMany({
          data: markupTiers.map((t) => ({
            minCost: t.minCost,
            markupBps: t.markupBps,
          })),
        }),
      ]);
    }
    await this.settings.update(rest);
    if (markupTiers !== undefined || rest.priceRoundingStep !== undefined) {
      // Второй bump обязателен: между первым (в settings.update) и концом пересчёта
      // витрина успела бы закэшироваться со старыми ценами.
      if ((await this.recalculate({})) > 0) await this.cache.bump();
    }
    return this.getSettings();
  }

  /** Порядок источников цены: первый подходящий сверху даёт цену. */
  async getPriorities(db: Db = this.prisma): Promise<PriceSource[]> {
    const rows = await db.pricePriority.findMany({
      orderBy: { position: 'asc' },
    });
    // Строк нет или не все (БД без сида миграции) — порядок по умолчанию.
    if (rows.length !== DEFAULT_PRICE_ORDER.length) return DEFAULT_PRICE_ORDER;
    return rows.map((r) => r.source);
  }

  /**
   * PUT /admin/price-priorities: новый порядок целиком. Базовая наценка подходит
   * любому листингу, поэтому обязана быть последней — всё под ней не сработало бы
   * никогда. Меняет цену всей витрины, поэтому полный пересчёт.
   */
  async setPriorities(order: PriceSource[]): Promise<PriceSource[]> {
    const all = new Set<PriceSource>(DEFAULT_PRICE_ORDER);
    if (
      order.length !== all.size ||
      new Set(order).size !== all.size ||
      order.some((s) => !all.has(s))
    ) {
      throw new BadRequestException(
        'Порядок должен содержать каждый источник цены ровно один раз',
      );
    }
    if (order[order.length - 1] !== PriceSource.BASE_MARKUP) {
      throw new BadRequestException('Базовая наценка должна быть последней');
    }
    await this.prisma.$transaction(async (tx) => {
      // position уникален: построчный update упёрся бы в unique посередине
      // перестановки, поэтому три строки просто пишутся заново.
      await tx.pricePriority.deleteMany();
      await tx.pricePriority.createMany({
        data: order.map((source, position) => ({ source, position })),
      });
    });
    if ((await this.recalculate({})) > 0) await this.cache.bump();
    return this.getPriorities();
  }

  async config(db: Db = this.prisma): Promise<PriceConfig> {
    const [s, markupTiers, order] = await Promise.all([
      this.settings.get(),
      this.loadTiers(db),
      this.getPriorities(db),
    ]);
    return { markupTiers, roundingStep: s.priceRoundingStep, order };
  }

  private async loadTiers(db: Db): Promise<MarkupTierInput[]> {
    return db.markupTier.findMany({
      select: { minCost: true, markupBps: true },
      orderBy: { minCost: 'asc' },
    });
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
    const [config, promotions] = await Promise.all([
      this.config(db),
      this.loadPromotions(db, now),
    ]);

    let changed = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await db.listing.findMany({
        where,
        select: {
          id: true,
          costPrice: true,
          customMarkupBps: true,
          price: true,
          priceSource: true,
          oldPrice: true,
          promotionId: true,
        },
        orderBy: { id: 'asc' },
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        take: PAGE_SIZE,
      });
      if (page.length === 0) break;

      const updates = page.flatMap((l) => {
        const resolved = resolvePrice(
          { costPrice: l.costPrice, customMarkupBps: l.customMarkupBps },
          config,
          promotions.get(l.id) ?? [],
          now,
        );
        return resolved.price === l.price &&
          resolved.source === l.priceSource &&
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
              "priceSource" = v.source::"PriceSource",
              "oldPrice" = v.old_price,
              "promotionId" = v.promotion_id,
              "onPromo" = v.promotion_id IS NOT NULL
          FROM (VALUES ${Prisma.join(
            chunk.map(
              (u) =>
                Prisma.sql`(${u.id}::text, ${u.price}::int, ${u.source}::text, ${u.oldPrice}::int, ${u.promotionId}::text)`,
            ),
          )}) AS v(id, price, source, old_price, promotion_id)
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
        promoPrice: true,
        promotion: { select: { id: true, startsAt: true, endsAt: true } },
      },
    });
    const byListing = new Map<string, PromotionCandidate[]>();
    for (const item of items) {
      const list = byListing.get(item.listingId) ?? [];
      list.push({
        promotionId: item.promotion.id,
        promoPrice: item.promoPrice,
        startsAt: item.promotion.startsAt,
        endsAt: item.promotion.endsAt,
      });
      byListing.set(item.listingId, list);
    }
    return byListing;
  }
}

/**
 * Ступени базовой наценки: 1..MAX_TIERS, первая — с нуля (иначе дешёвым позициям не
 * досталось бы наценки), границы строго по возрастанию.
 */
function validateTiers(tiers: MarkupTierDto[]): void {
  if (tiers.length === 0 || tiers.length > MAX_TIERS) {
    throw new BadRequestException(`Ступеней наценки — от 1 до ${MAX_TIERS}`);
  }
  if (tiers[0].minCost !== 0) {
    throw new BadRequestException(
      'Первая ступень наценки должна начинаться с 0',
    );
  }
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minCost <= tiers[i - 1].minCost) {
      throw new BadRequestException(
        'Границы ступеней наценки должны идти по возрастанию',
      );
    }
  }
}
