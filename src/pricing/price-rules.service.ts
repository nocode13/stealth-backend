import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Locale, PriceRuleAction, Prisma } from '@prisma/client';
import type { PriceRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { pickTranslation } from '../i18n/pick';
import { DEFAULT_LOCALE } from '../i18n/locale';
import {
  dayEndExclusive,
  dayStart,
  toEndDay,
  toStartDay,
} from './business-day';
import { PricingService, ruleScopeWhere } from './pricing.service';
import {
  CreatePriceRuleDto,
  FindPriceRulesQueryDto,
  UpdatePriceRuleDto,
} from './dto/price-rule.dto';

// Процентные правила: наценка — до +1000%, скидка — не больше 100% (дальше цену всё
// равно упрёт в себестоимость, но 150% скидки — явно опечатка в форме).
const MAX_MARKUP_BPS = 100_000;
const MAX_DISCOUNT_BPS = 10_000;

const withScope = {
  seller: { select: { id: true, translations: true } },
  category: { select: { id: true, translations: true } },
  catalogItem: { select: { id: true, translations: true } },
  listing: {
    select: {
      id: true,
      seller: { select: { translations: true } },
      catalogItem: { select: { translations: true } },
    },
  },
  _count: { select: { appliedTo: true } },
} satisfies Prisma.PriceRuleInclude;

type PriceRuleWithScope = Prisma.PriceRuleGetPayload<{
  include: typeof withScope;
}>;

/** Ответ админке (только SUPER_ADMIN). Даты — дни `YYYY-MM-DD`, см. business-day.ts. */
export interface PriceRuleResponse {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  action: PriceRuleAction;
  value: number;
  sellerId: string | null;
  seller: { id: string; name: string } | null;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  catalogItemId: string | null;
  catalogItem: { id: string; name: string } | null;
  listingId: string | null;
  listing: { id: string; name: string } | null;
  startDate: string | null;
  endDate: string | null;
  minStock: number | null;
  maxStock: number | null;
  /** Сколько листингов сейчас получили цену по этому правилу. */
  appliedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const nameOf = (translations: { locale: Locale; name: string }[]) =>
  pickTranslation(translations, DEFAULT_LOCALE).name;

const toPriceRuleResponse = (r: PriceRuleWithScope): PriceRuleResponse => ({
  id: r.id,
  name: r.name,
  enabled: r.enabled,
  priority: r.priority,
  action: r.action,
  value: r.value,
  sellerId: r.sellerId,
  seller: r.seller
    ? { id: r.seller.id, name: nameOf(r.seller.translations) }
    : null,
  categoryId: r.categoryId,
  category: r.category
    ? { id: r.category.id, name: nameOf(r.category.translations) }
    : null,
  catalogItemId: r.catalogItemId,
  catalogItem: r.catalogItem
    ? { id: r.catalogItem.id, name: nameOf(r.catalogItem.translations) }
    : null,
  listingId: r.listingId,
  listing: r.listing
    ? {
        id: r.listing.id,
        name: `${nameOf(r.listing.catalogItem.translations)} — ${nameOf(
          r.listing.seller.translations,
        )}`,
      }
    : null,
  startDate: toStartDay(r.startsAt),
  endDate: toEndDay(r.endsAt),
  minStock: r.minStock,
  maxStock: r.maxStock,
  appliedCount: r._count.appliedTo,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Поля правила, которые пишет форма. Даты уже переведены из дней в полночи. */
type RuleFields = Partial<
  Pick<
    PriceRule,
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
  >
>;

/**
 * DTO → поля строки. Ключи со значением undefined выбрасываются: иначе при слиянии
 * со старой строкой ({ ...old, ...fields }) «не трогать» превратилось бы в «стереть».
 * null остаётся null — «снять ограничение».
 */
function toFields(dto: UpdatePriceRuleDto): RuleFields {
  const { startDate, endDate, ...rest } = dto;
  const fields: RuleFields = {
    ...rest,
    startsAt:
      startDate === undefined
        ? undefined
        : startDate === null
          ? null
          : dayStart(startDate),
    endsAt:
      endDate === undefined
        ? undefined
        : endDate === null
          ? null
          : dayEndExclusive(endDate),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
}

/**
 * CRUD правил цены (admin/price-rules, только SUPER_ADMIN). Каждая мутация в той же
 * транзакции пересчитывает листинги области правила — и старой, и новой: правило
 * могло «уехать» с одних листингов на другие. cache.bump() — после коммита.
 */
@Injectable()
export class PriceRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly cache: CacheService,
  ) {}

  async findAll(
    query: FindPriceRulesQueryDto,
  ): Promise<CursorPage<PriceRuleResponse>> {
    const rows = await this.prisma.priceRule.findMany({
      where: query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : undefined,
      include: withScope,
      orderBy: [{ priority: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return { ...page, items: page.items.map(toPriceRuleResponse) };
  }

  async findOne(id: string): Promise<PriceRuleResponse> {
    return toPriceRuleResponse(await this.findRaw(id));
  }

  private async findRaw(id: string): Promise<PriceRuleWithScope> {
    const rule = await this.prisma.priceRule.findUnique({
      where: { id },
      include: withScope,
    });
    if (!rule) throw new NotFoundException('Правило цены не найдено');
    return rule;
  }

  async create(dto: CreatePriceRuleDto): Promise<PriceRuleResponse> {
    const data = {
      ...toFields(dto),
      name: dto.name,
      priority: dto.priority,
      action: dto.action,
      value: dto.value,
    };
    this.validate(data);
    const id = await this.withFkErrors(() =>
      this.prisma.$transaction(async (tx) => {
        const rule = await tx.priceRule.create({ data });
        await this.pricing.recalculate(ruleScopeWhere(rule), tx);
        return rule.id;
      }),
    );
    await this.cache.bump();
    return this.findOne(id);
  }

  async update(
    id: string,
    dto: UpdatePriceRuleDto,
  ): Promise<PriceRuleResponse> {
    const old = await this.findRaw(id);
    const data = toFields(dto);
    this.validate({ ...old, ...data });
    await this.withFkErrors(() =>
      this.prisma.$transaction(async (tx) => {
        const rule = await tx.priceRule.update({ where: { id }, data });
        await this.pricing.recalculate(
          { OR: [ruleScopeWhere(old), ruleScopeWhere(rule)] },
          tx,
        );
      }),
    );
    await this.cache.bump();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const old = await this.findRaw(id);
    await this.prisma.$transaction(async (tx) => {
      // appliedRuleId у листингов обнулит FK (SetNull), цену — пересчёт.
      await tx.priceRule.delete({ where: { id } });
      await this.pricing.recalculate(ruleScopeWhere(old), tx);
    });
    await this.cache.bump();
  }

  // Проверки по итогу слияния: в PATCH может прийти только action или только value.
  private validate(
    r: Pick<PriceRule, 'action' | 'value'> &
      Pick<RuleFields, 'startsAt' | 'endsAt' | 'minStock' | 'maxStock'>,
  ): void {
    if (
      r.action === PriceRuleAction.MARKUP_PERCENT &&
      r.value > MAX_MARKUP_BPS
    ) {
      throw new BadRequestException('Наценка не больше 1000%');
    }
    if (
      r.action === PriceRuleAction.DISCOUNT_PERCENT &&
      r.value > MAX_DISCOUNT_BPS
    ) {
      throw new BadRequestException('Скидка не больше 100%');
    }
    if (r.startsAt && r.endsAt && r.endsAt <= r.startsAt) {
      throw new BadRequestException(
        'Последний день не может быть раньше первого',
      );
    }
    if (
      r.minStock !== null &&
      r.minStock !== undefined &&
      r.maxStock !== null &&
      r.maxStock !== undefined &&
      r.minStock > r.maxStock
    ) {
      throw new BadRequestException('Мин. остаток больше макс.');
    }
  }

  // Несуществующий продавец/категория/позиция/листинг в области → 400, а не 500.
  private async withFkErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Область правила ссылается на несуществующую сущность',
        );
      }
      throw error;
    }
  }
}
