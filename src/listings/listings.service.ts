import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Listing, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CatalogService } from '../catalog/catalog.service';
import {
  CreateListingDto,
  FindListingsQueryDto,
  UpdateListingDto,
} from './dto/listing.dto';

const withCatalog = {
  catalogItem: { include: { category: true } },
  seller: { select: { id: true, name: true } },
} satisfies Prisma.ListingInclude;

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
  ) {}

  // Витрина мобилки: только активные листинги. status из query игнорируется — тут
  // всегда ACTIVE + остаток > 0.
  async findStorefront(
    query: FindListingsQueryDto,
  ): Promise<CursorPage<Listing>> {
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
  }

  // Одно активное предложение для витрины мобилки (карточка товара).
  async findOnePublic(id: string): Promise<Listing> {
    const listing = await this.prisma.listing.findFirst({
      where: { id, status: ListingStatus.ACTIVE, stock: { gt: 0 } },
      include: withCatalog,
    });
    if (!listing) throw new NotFoundException('Листинг не найден');
    return listing;
  }

  // Листинги конкретного продавца (админка).
  async findForSeller(
    sellerId: string,
    query: FindListingsQueryDto,
  ): Promise<CursorPage<Listing>> {
    const rows = await this.prisma.listing.findMany({
      where: {
        sellerId,
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
    return toCursorPage(rows, query.limit);
  }

  async findOneForSeller(id: string, sellerId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: withCatalog,
    });
    if (!listing) throw new NotFoundException('Листинг не найден');
    if (listing.sellerId !== sellerId) {
      throw new ForbiddenException('Чужой листинг');
    }
    return listing;
  }

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    await this.catalog.assertUsable(dto.catalogItemId, sellerId);
    return this.prisma.listing.create({
      data: { ...dto, sellerId },
      include: withCatalog,
    });
  }

  async update(
    id: string,
    sellerId: string,
    dto: UpdateListingDto,
  ): Promise<Listing> {
    await this.findOneForSeller(id, sellerId);
    return this.prisma.listing.update({
      where: { id },
      data: dto,
      include: withCatalog,
    });
  }

  async remove(id: string, sellerId: string): Promise<void> {
    await this.findOneForSeller(id, sellerId);
    await this.prisma.listing.delete({ where: { id } });
  }
}
