import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PlatformSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SettingsService } from '../settings/settings.service';
import { UpdatePlatformSettingsDto } from '../settings/dto/settings.dto';
import { PriceConfig, resolvePrice } from './price-engine';

type Db = PrismaService | Prisma.TransactionClient;

// Сколько листингов читаем за проход и сколько строк кладём в один UPDATE.
// Пересчёт всей витрины (смена наценки) идёт кусками, а не одним findMany.
const PAGE_SIZE = 1000;
const UPDATE_CHUNK = 500;

/**
 * Единственное место, которое пишет Listing.price. Розница денормализована: считается
 * при записи (листинг, настройки, остаток, правила), а не при чтении — поэтому
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
    const [config, rules] = await Promise.all([
      this.config(),
      db.priceRule.findMany({ where: { enabled: true } }),
    ]);
    const now = new Date();

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
          now,
        );
        return resolved.price === l.price &&
          resolved.appliedRuleId === l.appliedRuleId
          ? []
          : [{ id: l.id, ...resolved }];
      });

      for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
        const chunk = updates.slice(i, i + UPDATE_CHUNK);
        await db.$executeRaw`
          UPDATE "listings" AS l
          SET "price" = v.price, "appliedRuleId" = v.rule_id
          FROM (VALUES ${Prisma.join(
            chunk.map(
              (u) =>
                Prisma.sql`(${u.id}::text, ${u.price}::int, ${u.appliedRuleId}::text)`,
            ),
          )}) AS v(id, price, rule_id)
          WHERE l.id = v.id
        `;
      }
      changed += updates.length;

      if (page.length < PAGE_SIZE) break;
      cursor = page[page.length - 1].id;
    }
    return changed;
  }
}
