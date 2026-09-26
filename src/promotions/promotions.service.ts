import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { normalizePromotionTranslations } from '../i18n/translations.util';
import { PricingService } from '../pricing/pricing.service';
import { dayEndExclusive, dayStart } from '../pricing/business-day';
import {
  AdminPromotionDetailResponse,
  AdminPromotionResponse,
  toAdminPromotionDetailResponse,
  toAdminPromotionResponse,
  withAdminPromotion,
  withAdminPromotionItems,
} from './promotion.response';
import {
  CreatePromotionDto,
  FindPromotionsQueryDto,
  PromotionItemDto,
  PromotionState,
  UpdatePromotionDto,
} from './dto/promotion.dto';

// Ищем по ЛЮБОЙ локали, как у стран/категорий.
function searchFilter(search?: string): Prisma.PromotionWhereInput {
  if (!search) return {};
  return {
    translations: {
      some: { title: { contains: search, mode: 'insensitive' } },
    },
  };
}

// Зеркало promotionState() в виде where — фильтр списка в админке.
function stateFilter(
  state: PromotionState | undefined,
  now: Date,
): Prisma.PromotionWhereInput {
  switch (state) {
    case 'disabled':
      return { enabled: false };
    case 'scheduled':
      return { enabled: true, startsAt: { gt: now } };
    case 'ended':
      return { enabled: true, endsAt: { lte: now } };
    case 'active':
      return {
        enabled: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      };
    default:
      return {};
  }
}

const toStartsAt = (day: string | null | undefined) =>
  day === undefined ? undefined : day === null ? null : dayStart(day);
const toEndsAt = (day: string | null | undefined) =>
  day === undefined ? undefined : day === null ? null : dayEndExclusive(day);

/**
 * Акции (admin/promotions, только SUPER_ADMIN). Цены сами по себе здесь не
 * считаются: любая мутация в той же транзакции зовёт PricingService.recalculate по
 * листингам акции — и прежнего состава, и нового (выбывший листинг должен вернуться
 * к обычной цене). cache.bump() — после коммита, как везде.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly cache: CacheService,
  ) {}

  async findAll(
    query: FindPromotionsQueryDto,
  ): Promise<CursorPage<AdminPromotionResponse>> {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: {
        ...searchFilter(query.search),
        ...stateFilter(query.state, now),
      },
      include: withAdminPromotion,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      items: page.items.map((p) => toAdminPromotionResponse(p, now)),
    };
  }

  async findOne(id: string): Promise<AdminPromotionDetailResponse> {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      include: withAdminPromotionItems,
    });
    if (!promotion) throw new NotFoundException('Акция не найдена');
    return toAdminPromotionDetailResponse(promotion, new Date());
  }

  async create(dto: CreatePromotionDto): Promise<AdminPromotionDetailResponse> {
    const translations = normalizePromotionTranslations(dto.translations);
    const startsAt = toStartsAt(dto.startDate) ?? null;
    const endsAt = toEndsAt(dto.endDate) ?? null;
    assertPeriod(startsAt, endsAt);
    const items = uniqueItems(dto.items);

    const id = await withFkErrors(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.promotion.create({
          data: {
            discountBps: dto.discountBps,
            enabled: dto.enabled,
            startsAt,
            endsAt,
            translations: { create: translations },
            items: { create: items },
          },
        });
        await this.recalculate(
          tx,
          items.map((i) => i.listingId),
        );
        return created.id;
      }),
    );
    await this.cache.bump();
    return this.findOne(id);
  }

  async update(
    id: string,
    dto: UpdatePromotionDto,
  ): Promise<AdminPromotionDetailResponse> {
    const old = await this.prisma.promotion.findUnique({
      where: { id },
      include: { items: { select: { listingId: true } } },
    });
    if (!old) throw new NotFoundException('Акция не найдена');

    const translations = dto.translations
      ? normalizePromotionTranslations(dto.translations)
      : null;
    const startsAt = toStartsAt(dto.startDate);
    const endsAt = toEndsAt(dto.endDate);
    assertPeriod(
      startsAt === undefined ? old.startsAt : startsAt,
      endsAt === undefined ? old.endsAt : endsAt,
    );
    const items = dto.items ? uniqueItems(dto.items) : null;

    await withFkErrors(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.promotion.update({
          where: { id },
          data: {
            discountBps: dto.discountBps,
            enabled: dto.enabled,
            startsAt,
            endsAt,
          },
        });
        if (translations) {
          for (const t of translations) {
            await tx.promotionTranslation.upsert({
              where: {
                promotionId_locale: { promotionId: id, locale: t.locale },
              },
              create: { promotionId: id, ...t },
              update: {
                title: t.title,
                description: t.description,
                auto: t.auto,
              },
            });
          }
        }
        if (items) {
          await tx.promotionItem.deleteMany({ where: { promotionId: id } });
          await tx.promotionItem.createMany({
            data: items.map((i) => ({ ...i, promotionId: id })),
          });
        }
        await this.recalculate(tx, [
          ...old.items.map((i) => i.listingId),
          ...(items ?? []).map((i) => i.listingId),
        ]);
      }),
    );
    await this.cache.bump();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const old = await this.prisma.promotion.findUnique({
      where: { id },
      include: { items: { select: { listingId: true } } },
    });
    if (!old) throw new NotFoundException('Акция не найдена');
    await this.prisma.$transaction(async (tx) => {
      // promotionId у листингов обнулит FK (SetNull), цену и oldPrice — пересчёт.
      await tx.promotion.delete({ where: { id } });
      await this.recalculate(
        tx,
        old.items.map((i) => i.listingId),
      );
    });
    await this.cache.bump();
  }

  private async recalculate(
    tx: Prisma.TransactionClient,
    listingIds: string[],
  ): Promise<void> {
    if (listingIds.length === 0) return;
    await this.pricing.recalculate(
      { id: { in: [...new Set(listingIds)] } },
      tx,
    );
  }
}

function assertPeriod(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new BadRequestException(
      'Последний день не может быть раньше первого',
    );
  }
}

// Один листинг дважды в одной акции — ошибка формы, а не повод для P2002 → 500.
function uniqueItems(
  items: PromotionItemDto[],
): { listingId: string; discountBps: number | null }[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.listingId)) {
      throw new BadRequestException('Листинг добавлен в акцию дважды');
    }
    ids.add(item.listingId);
  }
  return items.map((i) => ({
    listingId: i.listingId,
    discountBps: i.discountBps ?? null,
  }));
}

// Несуществующий листинг в составе → 400, а не 500.
async function withFkErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw new BadRequestException('В акции есть несуществующий листинг');
    }
    throw error;
  }
}
