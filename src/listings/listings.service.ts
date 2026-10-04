import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Locale, ListingStatus, Prisma, Role } from '@prisma/client';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CatalogService } from '../catalog/catalog.service';
import { withMediaUrls } from '../catalog/catalog-media.util';
import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';
import { MediaGalleryService } from '../storage/media-gallery.service';
import { PricingService } from '../pricing/pricing.service';
import { err } from '../i18n/api-error';
import { DEFAULT_LOCALE } from '../i18n/locale';
import { ERRORS } from '../i18n/messages';
import {
  AdminListingResponse,
  AdminListingRow,
  adminListingInclude,
  toAdminListingResponse,
} from './listing.response';
import {
  ListingCardResponse,
  ListingDetailResponse,
  listingVariantSelect,
  mobileListingInclude,
  toListingCard,
  toListingDetail,
  toListingVariant,
} from './mobile-listing';
import { VARIANT_ORDER_BY, VariantFields, pickVariant } from './variant';
import {
  CreateListingDto,
  FindListingsQueryDto,
  ListingSort,
  UpdateListingDto,
} from './dto/listing.dto';
import { isListingCode, parseListingCode } from './listing-code';

// Порог word_similarity: 0 = что угодно совпадёт, 1 = точное совпадение.
// 0.3 ловит опечатки/окончания, не превращая поиск в «покажи всё».
const FUZZY_SEARCH_THRESHOLD = 0.3;

function buildPriceFilter(
  minPrice?: number,
  maxPrice?: number,
): Prisma.IntFilter | undefined {
  if (minPrice === undefined && maxPrice === undefined) return undefined;
  return { gte: minPrice, lte: maxPrice };
}

// «Новинки»: скользящее окно от текущего момента, не от начала бизнес-дня — для
// «за последние N дней» Ташкентская полночь не нужна. Внутри cache.wrap окно
// устаревает максимум на TTL кэша витрины.
function buildCreatedSinceFilter(
  days?: number,
): Prisma.DateTimeFilter | undefined {
  if (days === undefined) return undefined;
  return { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
}

/**
 * Порядок выдачи. Акционные листинги (`onPromo`) идут первыми в «новых» и
 * «бесплатной доставке» (дефолт мобилки); сортировки по цене остаются честными —
 * иначе «сначала дешёвые» показывал бы дорогую акцию выше дешёвого товара.
 * ⚠️ `id` обязан быть последним в каждой ветке: курсорная пагинация
 * (`cursor: { id }`, `skip: 1`) детерминирована только при orderBy, заканчивающемся на
 * уникальном поле. Без тайбрейкера листинги с одинаковой ценой дублируются и пропадают
 * между страницами. См. контракт в `src/common/pagination.ts`.
 */
function buildOrderBy(
  sort?: ListingSort,
): Prisma.ListingOrderByWithRelationInput[] {
  switch (sort) {
    case ListingSort.PRICE_ASC:
      return [{ price: 'asc' }, { id: 'asc' }];
    case ListingSort.PRICE_DESC:
      return [{ price: 'desc' }, { id: 'desc' }];
    // Бесплатная доставка — сортировка, а не фильтр: фильтр прятал половину витрины.
    // Внутри групп — сначала дешёвые (схлопнуто с price_asc в одну опцию мобилки).
    case ListingSort.FREE_DELIVERY:
      return [
        { onPromo: 'desc' },
        { catalogItem: { freeDelivery: 'desc' } },
        { price: 'asc' },
        { id: 'asc' },
      ];
    case ListingSort.NEWEST:
    default:
      return [{ onPromo: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
  }
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly gallery: MediaGalleryService,
  ) {}

  // media хранит ключи S3-объектов — здесь собираем полные URL для ответа. Кэш
  // (findStorefront/findOnePublic) хранит сырые ключи: мэппинг применяется ПОСЛЕ
  // cache.wrap(), как и в CatalogService.
  private withUrls<T extends ListingCardResponse>(listing: T): T {
    return withMediaUrls(this.storage, listing);
  }

  private withAdminUrls(listing: AdminListingResponse): AdminListingResponse {
    return {
      ...listing,
      catalogItem: withMediaUrls(this.storage, listing.catalogItem),
      ownMedia: withMediaUrls(this.storage, { media: listing.ownMedia }).media,
    };
  }

  // Fuzzy-поиск по названию: word_similarity толерантен к опечаткам и ищет
  // search как подстроку-слово внутри более длинного названия (в отличие от
  // similarity(), которая сравнивает строки целиком и на «роза» против «Красная
  // роза 60 см» даёт низкий скор). Ищет по всем локалям разом — то же поведение,
  // что было у contains, translations не фильтруются по locale запроса.
  private async findFuzzyCatalogItemIds(search: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ catalogItemId: string }[]>(
      Prisma.sql`
        SELECT DISTINCT "catalogItemId"
        FROM "catalog_item_translations"
        WHERE word_similarity(lower(${search}), lower("name")) > ${FUZZY_SEARCH_THRESHOLD}
      `,
    );
    return rows.map((r) => r.catalogItemId);
  }

  // Строка поиска → фильтр: артикул («10001» / «#10001») ищется точно по code,
  // всё остальное — fuzzy по названию. Оба поля undefined — поиска нет.
  private async resolveSearch(
    search?: string,
  ): Promise<{ code?: number; catalogItemIds?: string[] }> {
    if (!search) return {};
    const code = parseListingCode(search);
    if (code !== null) return { code };
    return { catalogItemIds: await this.findFuzzyCatalogItemIds(search) };
  }

  // Витрина мобилки: только активные листинги. status из query игнорируется — тут
  // всегда ACTIVE + остаток > 0.
  async findStorefront(
    query: FindListingsQueryDto,
    locale: Locale,
  ): Promise<CursorPage<ListingCardResponse>> {
    // locale ОБЯЗАН быть в params: ключ кэша считается только по ним (см. И3).
    const page = await this.cache.wrap(
      'listings',
      { ...query, locale },
      async () => {
        const { code, catalogItemIds } = await this.resolveSearch(query.search);
        const rows = await this.prisma.listing.findMany({
          where: {
            code,
            status: ListingStatus.ACTIVE,
            stock: { gt: 0 },
            sellerId: query.sellerId,
            price: buildPriceFilter(query.minPrice, query.maxPrice),
            createdAt: buildCreatedSinceFilter(query.createdWithinDays),
            seedling: query.seedling ? true : undefined,
            catalogItem: {
              categoryId: query.categoryId,
              countryId: query.countryId,
              id: catalogItemIds ? { in: catalogItemIds } : undefined,
            },
          },
          include: mobileListingInclude,
          orderBy: buildOrderBy(query.sort),
          cursor: query.cursor ? { id: query.cursor } : undefined,
          skip: query.cursor ? 1 : 0,
          take: query.limit + 1,
        });
        const mapped = rows.map((l) => toListingCard(l, locale));
        return toCursorPage(mapped, query.limit);
      },
    );
    return { ...page, items: page.items.map((l) => this.withUrls(l)) };
  }

  // Одно активное предложение для витрины мобилки (карточка товара) + все доступные
  // варианты той же позиции у того же продавца (чипы «другие варианты»). Принимает и
  // cuid, и артикул: короткие ссылки app.egen.uz/l/<code> открывают ту же карточку.
  async findOnePublic(
    idOrCode: string,
    locale: Locale,
  ): Promise<ListingDetailResponse> {
    const listing = await this.cache.wrap(
      'listing',
      { id: idOrCode, locale },
      async () => {
        const found = await this.prisma.listing.findFirst({
          where: {
            ...(isListingCode(idOrCode)
              ? { code: Number(idOrCode) }
              : { id: idOrCode }),
            status: ListingStatus.ACTIVE,
            stock: { gt: 0 },
          },
          include: mobileListingInclude,
        });
        // Промах в БД не кешируется: исключение из колбэка wrap пробрасывает как есть.
        if (!found) throw new NotFoundException(err(ERRORS.LISTING_NOT_FOUND));
        const variants = await this.prisma.listing.findMany({
          where: {
            sellerId: found.sellerId,
            catalogItemId: found.catalogItemId,
            status: ListingStatus.ACTIVE,
            stock: { gt: 0 },
          },
          select: listingVariantSelect,
          orderBy: VARIANT_ORDER_BY,
        });
        return toListingDetail(found, variants.map(toListingVariant), locale);
      },
    );
    return this.withUrls(listing);
  }

  // Листинги конкретного продавца (админка). sellerId === null — SUPER_ADMIN
  // смотрит без скоупа: все листинги всех продавцов. Роль передаётся отдельно:
  // SUPER_ADMIN с ?sellerId= тоже приходит с непустым sellerId, а видеть он
  // должен розницу, а не только себестоимость.
  async findForSeller(
    sellerId: string | null,
    query: FindListingsQueryDto,
    role: Role,
  ): Promise<CursorPage<AdminListingResponse>> {
    const { code, catalogItemIds } = await this.resolveSearch(query.search);
    // Продавец розницу не видит — и фильтрует по той цене, которую знает.
    const priceFilter = buildPriceFilter(query.minPrice, query.maxPrice);
    const rows = await this.prisma.listing.findMany({
      where: {
        code,
        sellerId: sellerId ?? undefined,
        status: query.status,
        ...(role === Role.SUPER_ADMIN
          ? { price: priceFilter }
          : { costPrice: priceFilter }),
        createdAt: buildCreatedSinceFilter(query.createdWithinDays),
        seedling: query.seedling ? true : undefined,
        catalogItem: {
          categoryId: query.categoryId,
          countryId: query.countryId,
          id: catalogItemIds ? { in: catalogItemIds } : undefined,
        },
      },
      include: adminListingInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const mapped = rows.map((l) =>
      toAdminListingResponse(l, DEFAULT_LOCALE, role),
    );
    const page = toCursorPage(mapped, query.limit);
    return { ...page, items: page.items.map((l) => this.withAdminUrls(l)) };
  }

  // sellerId === null — SUPER_ADMIN, проверку владения пропускаем.
  async findOneForSeller(
    id: string,
    sellerId: string | null,
    role: Role,
  ): Promise<AdminListingResponse> {
    const listing = await this.findOwned(id, sellerId);
    return this.toAdmin(listing, role);
  }

  private async findOwned(id: string, sellerId: string | null) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: adminListingInclude,
    });
    if (!listing) throw new NotFoundException(err(ERRORS.LISTING_NOT_FOUND));
    if (sellerId !== null && listing.sellerId !== sellerId) {
      throw new ForbiddenException('Чужой листинг');
    }
    return listing;
  }

  private toAdmin(listing: AdminListingRow, role: Role): AdminListingResponse {
    return this.withAdminUrls(
      toAdminListingResponse(listing, DEFAULT_LOCALE, role),
    );
  }

  // Розница пересчитывается в той же транзакции, что и запись costPrice/stock:
  // листинг не должен ни на миг оказаться на витрине с устаревшей ценой.
  private async reloadPriced(tx: Prisma.TransactionClient, id: string) {
    await this.pricing.recalculate({ id }, tx);
    return tx.listing.findUniqueOrThrow({
      where: { id },
      include: adminListingInclude,
    });
  }

  async create(
    sellerId: string,
    dto: CreateListingDto,
    role: Role,
  ): Promise<AdminListingResponse> {
    // sellerId из тела уже разрешён контроллером (SUPER_ADMIN выбирает продавца),
    // в data он не должен попасть повторно.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sellerId: _, ...data } = dto;
    assertCanSetMarkup(dto, role);
    await this.catalog.assertUsable(data.catalogItemId, sellerId);
    await this.assertVariantFree(sellerId, data.catalogItemId, {
      seedling: data.seedling ?? false,
      potVolumeMl: data.potVolumeMl ?? null,
      stemCount: data.stemCount ?? null,
      heightCm: data.heightCm ?? null,
    });
    const listing = await this.prisma.$transaction(async (tx) => {
      // price NOT NULL, а считает её только PricingService.recalculate — кладём
      // себестоимость и сразу пересчитываем.
      const created = await tx.listing.create({
        data: { ...data, price: data.costPrice, sellerId },
      });
      return this.reloadPriced(tx, created.id);
    });
    await this.cache.bump();
    return this.toAdmin(listing, role);
  }

  async update(
    id: string,
    sellerId: string | null,
    dto: UpdateListingDto,
    role: Role,
  ): Promise<AdminListingResponse> {
    assertCanSetMarkup(dto, role);
    const current = await this.findOwned(id, sellerId);
    // Смена позиции каталога или атрибутов — снова проверяем, что такого варианта
    // у продавца ещё нет. undefined в PATCH = «поле не трогаем».
    const catalogItemId = dto.catalogItemId ?? current.catalogItemId;
    if (dto.catalogItemId !== undefined) {
      await this.catalog.assertUsable(dto.catalogItemId, current.sellerId);
    }
    const next = { ...pickVariant(current) };
    if (dto.seedling !== undefined) next.seedling = dto.seedling;
    if (dto.potVolumeMl !== undefined) next.potVolumeMl = dto.potVolumeMl;
    if (dto.stemCount !== undefined) next.stemCount = dto.stemCount;
    if (dto.heightCm !== undefined) next.heightCm = dto.heightCm;
    await this.assertVariantFree(current.sellerId, catalogItemId, next, id);

    const listing = await this.prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data: dto });
      return this.reloadPriced(tx, id);
    });
    await this.cache.bump();
    return this.toAdmin(listing, role);
  }

  async remove(id: string, sellerId: string | null): Promise<void> {
    await this.findOwned(id, sellerId);
    // Строки своей галереи уходят каскадом, объекты в бакете — нет: гасим их
    // так же, как при удалении одного медиафайла.
    for (const media of await this.gallery.list({ listingId: id })) {
      await this.gallery.remove({ listingId: id }, media.id);
    }
    await this.prisma.listing.delete({ where: { id } });
    await this.cache.bump();
  }

  // ── Своя галерея варианта. Пустая — витрина показывает фото каталога. ──

  async addMedia(
    id: string,
    sellerId: string | null,
    file: Express.Multer.File,
    role: Role,
  ): Promise<AdminListingResponse> {
    await this.findOwned(id, sellerId);
    await this.gallery.add({ listingId: id }, file);
    return this.toAdmin(await this.findOwned(id, sellerId), role);
  }

  async removeMedia(
    id: string,
    sellerId: string | null,
    mediaId: string,
    role: Role,
  ): Promise<AdminListingResponse> {
    await this.findOwned(id, sellerId);
    await this.gallery.remove({ listingId: id }, mediaId);
    return this.toAdmin(await this.findOwned(id, sellerId), role);
  }

  async reorderMedia(
    id: string,
    sellerId: string | null,
    mediaId: string,
    direction: 'up' | 'down',
    role: Role,
  ): Promise<AdminListingResponse> {
    await this.findOwned(id, sellerId);
    await this.gallery.reorder({ listingId: id }, mediaId, direction);
    return this.toAdmin(await this.findOwned(id, sellerId), role);
  }

  /**
   * Вариант уникален в пределах продавца и позиции каталога. Проверка в коде, а не
   * индексом: NULL в Postgres-unique различны, NULLS NOT DISTINCT Prisma не
   * выражает. `field: null` в where Prisma компилирует в IS NULL — «не указано»
   * совпадает с «не указано». Гонку двух одновременных сохранений не ловит —
   * листинги заводят руками в админке, это приемлемо.
   */
  private async assertVariantFree(
    sellerId: string,
    catalogItemId: string,
    variant: VariantFields,
    exceptId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.listing.findFirst({
      where: {
        sellerId,
        catalogItemId,
        ...variant,
        id: exceptId ? { not: exceptId } : undefined,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'У продавца уже есть такой вариант этого товара',
      );
    }
  }
}

// Своя наценка — рычаг платформы: продавец её не видит и задать не может, даже себе.
function assertCanSetMarkup(
  dto: { customMarkupBps?: number | null },
  role: Role,
): void {
  if (dto.customMarkupBps !== undefined && role !== Role.SUPER_ADMIN) {
    throw new ForbiddenException('Свою наценку задаёт только супер-админ');
  }
}
