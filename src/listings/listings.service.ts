import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, MediaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CatalogService } from '../catalog/catalog.service';
import { withMediaUrls } from '../catalog/catalog-media.util';
import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateListingDto,
  FindListingsQueryDto,
  UpdateListingDto,
} from './dto/listing.dto';

// Витрина листингов ходит в каталог мимо CatalogService, поэтому фильтр «только
// готовые медиа» повторяется здесь (см. withCategoryPublic): недотранскоденное
// и упавшее видео покупателю показывать нельзя. Админский список листингов идёт
// через тот же include — там медиа только для превью, а редактируется галерея
// всё равно в каталоге.
const withCatalog = {
  catalogItem: {
    include: {
      category: true,
      media: {
        where: { status: MediaStatus.READY },
        orderBy: { sortOrder: 'asc' },
      },
    },
  },
  seller: { select: { id: true, name: true } },
} satisfies Prisma.ListingInclude;

export type Listing = Prisma.ListingGetPayload<{ include: typeof withCatalog }>;

function buildPriceFilter(
  minPrice?: number,
  maxPrice?: number,
): Prisma.IntFilter | undefined {
  if (minPrice === undefined && maxPrice === undefined) return undefined;
  return { gte: minPrice, lte: maxPrice };
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  // catalogItem.media хранит ключи S3-объектов — здесь собираем полные URL для ответа.
  // Кэш (findStorefront/findOnePublic) хранит сырые ключи: мэппинг применяется ПОСЛЕ
  // cache.wrap(), как и в CatalogService.
  private withUrls(listing: Listing): Listing {
    return {
      ...listing,
      catalogItem: withMediaUrls(this.storage, listing.catalogItem),
    };
  }

  // Витрина мобилки: только активные листинги. status из query игнорируется — тут
  // всегда ACTIVE + остаток > 0.
  async findStorefront(
    query: FindListingsQueryDto,
  ): Promise<CursorPage<Listing>> {
    const page = await this.cache.wrap('listings', query, async () => {
      const rows = await this.prisma.listing.findMany({
        where: {
          status: ListingStatus.ACTIVE,
          stock: { gt: 0 },
          sellerId: query.sellerId,
          price: buildPriceFilter(query.minPrice, query.maxPrice),
          catalogItem: {
            categoryId: query.categoryId,
            name: query.search
              ? { contains: query.search, mode: 'insensitive' }
              : undefined,
          },
        },
        include: withCatalog,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        take: query.limit + 1,
      });
      return toCursorPage(rows, query.limit);
    });
    return { ...page, items: page.items.map((l) => this.withUrls(l)) };
  }

  // Одно активное предложение для витрины мобилки (карточка товара).
  async findOnePublic(id: string): Promise<Listing> {
    const listing = await this.cache.wrap('listing', id, async () => {
      const found = await this.prisma.listing.findFirst({
        where: { id, status: ListingStatus.ACTIVE, stock: { gt: 0 } },
        include: withCatalog,
      });
      // Промах в БД не кешируется: исключение из колбэка wrap пробрасывает как есть.
      if (!found) throw new NotFoundException('Листинг не найден');
      return found;
    });
    return this.withUrls(listing);
  }

  // Листинги конкретного продавца (админка). sellerId === null — SUPER_ADMIN
  // смотрит без скоупа: все листинги всех продавцов.
  async findForSeller(
    sellerId: string | null,
    query: FindListingsQueryDto,
  ): Promise<CursorPage<Listing>> {
    const rows = await this.prisma.listing.findMany({
      where: {
        sellerId: sellerId ?? undefined,
        status: query.status,
        price: buildPriceFilter(query.minPrice, query.maxPrice),
        catalogItem: {
          categoryId: query.categoryId,
          name: query.search
            ? { contains: query.search, mode: 'insensitive' }
            : undefined,
        },
      },
      include: withCatalog,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return { ...page, items: page.items.map((l) => this.withUrls(l)) };
  }

  // sellerId === null — SUPER_ADMIN, проверку владения пропускаем.
  async findOneForSeller(
    id: string,
    sellerId: string | null,
  ): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: withCatalog,
    });
    if (!listing) throw new NotFoundException('Листинг не найден');
    if (sellerId !== null && listing.sellerId !== sellerId) {
      throw new ForbiddenException('Чужой листинг');
    }
    return this.withUrls(listing);
  }

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    // sellerId из тела уже разрешён контроллером (SUPER_ADMIN выбирает продавца),
    // в data он не должен попасть повторно.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sellerId: _, ...data } = dto;
    await this.catalog.assertUsable(data.catalogItemId, sellerId);
    try {
      const listing = await this.prisma.listing.create({
        data: { ...data, sellerId },
        include: withCatalog,
      });
      await this.cache.bump();
      return this.withUrls(listing);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'У продавца уже есть позиция по этому товару',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    sellerId: string | null,
    dto: UpdateListingDto,
  ): Promise<Listing> {
    await this.findOneForSeller(id, sellerId);
    const listing = await this.prisma.listing.update({
      where: { id },
      data: dto,
      include: withCatalog,
    });
    await this.cache.bump();
    return this.withUrls(listing);
  }

  async remove(id: string, sellerId: string | null): Promise<void> {
    await this.findOneForSeller(id, sellerId);
    await this.prisma.listing.delete({ where: { id } });
    await this.cache.bump();
  }
}
