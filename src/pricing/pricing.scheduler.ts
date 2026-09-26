import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { nextBusinessMidnight } from './business-day';
import { PricingService, ruleScopeWhere } from './pricing.service';

// Запас после полуночи: таймер Node может сработать на пару мс раньше расчётного, а
// граница окна дат — ровно 00:00. Пара секунд гарантирует, что движок уже по ту сторону.
const MIDNIGHT_SLACK_MS = 2_000;

/**
 * Полуночный тикер цен. Даты правил и акций — с точностью до дня (00:00 по Ташкенту,
 * см. business-day.ts), поэтому по датам цена меняется ровно раз в сутки: в полночь
 * пересчитываются листинги тех правил/акций, чья граница (startsAt/endsAt) попала в
 * (прошлый запуск, сейчас]. Правки из админки применяются сразу, тикер их не ждёт.
 *
 * При старте — полный пересчёт: полночь могла пройти, пока сервис лежал/деплоился.
 * Таймер ставится заново после каждого срабатывания (а не setInterval(24h)), чтобы не
 * копился дрейф. Реплика одна (railway numReplicas: 1) — распределённый лок не нужен.
 */
@Injectable()
export class PricingScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PricingScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRun = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly cache: CacheService,
  ) {}

  onApplicationBootstrap(): void {
    // Не await: полный пересчёт не должен задерживать старт и healthcheck.
    this.lastRun = new Date();
    void this.pricing
      .recalculate({})
      .then(async (changed) => {
        if (changed > 0) await this.cache.bump();
        this.logger.log(`Пересчёт цен при старте: изменено ${changed}`);
      })
      .catch((error: unknown) =>
        this.logger.error('Пересчёт цен при старте упал', error as Error),
      );
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const now = new Date();
    const delay =
      nextBusinessMidnight(now).getTime() - now.getTime() + MIDNIGHT_SLACK_MS;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, delay);
  }

  private async tick(): Promise<void> {
    const from = this.lastRun;
    const now = new Date();
    this.lastRun = now;
    try {
      const where = await this.transitionedScope(from, now);
      if (!where) return;
      const changed = await this.pricing.recalculate(where);
      if (changed > 0) await this.cache.bump();
      this.logger.log(`Полночный пересчёт цен: изменено ${changed}`);
    } catch (error) {
      this.logger.error('Полночный пересчёт цен упал', error as Error);
    }
  }

  /**
   * Листинги правил и акций, у которых граница дат попала в (from, now]. null —
   * пересчитывать нечего.
   */
  private async transitionedScope(
    from: Date,
    now: Date,
  ): Promise<Prisma.ListingWhereInput | null> {
    const crossed = {
      OR: [
        { startsAt: { gt: from, lte: now } },
        { endsAt: { gt: from, lte: now } },
      ],
    };
    const [rules, promoItems] = await Promise.all([
      this.prisma.priceRule.findMany({ where: { enabled: true, ...crossed } }),
      this.prisma.promotionItem.findMany({
        where: { promotion: { enabled: true, ...crossed } },
        select: { listingId: true },
      }),
    ]);
    const scopes: Prisma.ListingWhereInput[] = rules.map(ruleScopeWhere);
    if (promoItems.length > 0) {
      scopes.push({ id: { in: promoItems.map((i) => i.listingId) } });
    }
    return scopes.length > 0 ? { OR: scopes } : null;
  }
}
