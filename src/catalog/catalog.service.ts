import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CategoriesService } from '../categories/categories.service';
import { CacheService } from '../cache/cache.service';
import {
  CreateCatalogItemDto,
  FindCatalogQueryDto,
  UpdateCatalogItemDto,
} from './dto/catalog.dto';

const MAX_IMAGES_PER_ITEM = 10;

const withCategory = {
  category: true,
  images: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.CatalogItemInclude;

export type CatalogItem = Prisma.CatalogItemGetPayload<{
  include: typeof withCategory;
}>;

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  // Витрина (мобилка): только одобренные позиции, master и чужие продавцы вперемешку.
  async findAll(query: FindCatalogQueryDto): Promise<CursorPage<CatalogItem>> {
    return this.cache.wrap('catalog', query, async () => {
      const rows = await this.prisma.catalogItem.findMany({
        where: {
          status: ReviewStatus.APPROVED,
          name: query.search
            ? { contains: query.search, mode: 'insensitive' }
            : undefined,
          categoryId: query.noCategory ? null : query.categoryId,
        },
        include: withCategory,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        take: query.limit + 1,
      });
      return toCursorPage(rows, query.limit);
    });
  }

  // Админка: SUPER_ADMIN видит всё (+ фильтры status/sellerId), SELLER — master
  // APPROVED + свои (любой статус); status/sellerId для SELLER игнорируются.
  async findVisibleFor(
    user: AuthUser,
    query: FindCatalogQueryDto,
  ): Promise<CursorPage<CatalogItem>> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const where: Prisma.CatalogItemWhereInput = {
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
      categoryId: query.noCategory ? null : query.categoryId,
      ...(isSuperAdmin
        ? { status: query.status, sellerId: query.sellerId }
        : {
            OR: [
              { sellerId: null, status: ReviewStatus.APPROVED },
              { sellerId: user.sellerId ?? undefined },
            ],
          }),
    };
    const rows = await this.prisma.catalogItem.findMany({
      where,
      include: withCategory,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOne(id: string): Promise<CatalogItem> {
    const item = await this.prisma.catalogItem.findUnique({
      where: { id },
      include: withCategory,
    });
    if (!item) throw new NotFoundException('Позиция справочника не найдена');
    return item;
  }

  async create(
    dto: CreateCatalogItemDto,
    user: AuthUser,
  ): Promise<CatalogItem> {
    if (dto.categoryId) {
      await this.categories.assertUsable(dto.categoryId, user);
    }
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    // Уникальных ограничений (кроме id) у позиции нет — позиции с одинаковым
    // названием допустимы, ловить P2002 больше не от чего.
    const created = await this.prisma.catalogItem.create({
      data: {
        ...dto,
        sellerId: isSuperAdmin ? null : user.sellerId,
        status: isSuperAdmin ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
      },
      include: withCategory,
    });
    await this.cache.bump();
    return created;
  }

  async update(
    id: string,
    dto: UpdateCatalogItemDto,
    user: AuthUser,
  ): Promise<CatalogItem> {
    const item = await this.findOne(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    if (dto.status !== undefined && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Недостаточно прав');
    }
    if (dto.categoryId) {
      await this.categories.assertUsable(dto.categoryId, user);
    }
    const updated = await this.prisma.catalogItem.update({
      where: { id },
      data: dto,
      include: withCategory,
    });
    await this.cache.bump();
    return updated;
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const item = await this.findOne(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    await this.prisma.catalogItem.delete({ where: { id } });
    await this.cache.bump();
  }

  private async assertOwned(id: string, user: AuthUser) {
    const item = await this.findOne(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    return item;
  }

  async addImage(
    id: string,
    url: string,
    user: AuthUser,
  ): Promise<CatalogItem> {
    const item = await this.assertOwned(id, user);
    if (item.images.length >= MAX_IMAGES_PER_ITEM) {
      throw new ForbiddenException(
        `Не больше ${MAX_IMAGES_PER_ITEM} фото на позицию`,
      );
    }
    const nextSortOrder = item.images.length
      ? Math.max(...item.images.map((i) => i.sortOrder)) + 1
      : 0;
    await this.prisma.catalogItemImage.create({
      data: { catalogItemId: id, url, sortOrder: nextSortOrder },
    });
    await this.cache.bump();
    return this.findOne(id);
  }

  async removeImage(
    id: string,
    imageId: string,
    user: AuthUser,
  ): Promise<CatalogItem> {
    const item = await this.assertOwned(id, user);
    const image = item.images.find((i) => i.id === imageId);
    if (!image) throw new NotFoundException('Фото не найдено');

    const oldKey = this.storage.keyFromUrl(image.url);
    if (oldKey) {
      this.storage.delete(oldKey).catch((e: unknown) => {
        this.logger.warn(`Не удалось удалить фото ${oldKey}`, e);
      });
    }

    await this.prisma.catalogItemImage.delete({ where: { id: imageId } });
    await this.cache.bump();
    return this.findOne(id);
  }

  async reorderImage(
    id: string,
    imageId: string,
    direction: 'up' | 'down',
    user: AuthUser,
  ): Promise<CatalogItem> {
    const item = await this.assertOwned(id, user);
    const images = item.images; // уже отсортированы по sortOrder
    const index = images.findIndex((i) => i.id === imageId);
    if (index === -1) throw new NotFoundException('Фото не найдено');

    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= images.length) return item;

    const a = images[index];
    const b = images[swapWith];
    await this.prisma.$transaction([
      this.prisma.catalogItemImage.update({
        where: { id: a.id },
        data: { sortOrder: b.sortOrder },
      }),
      this.prisma.catalogItemImage.update({
        where: { id: b.id },
        data: { sortOrder: a.sortOrder },
      }),
    ]);
    await this.cache.bump();
    return this.findOne(id);
  }

  // Используется ListingsService: продавец может продавать только по одобренной
  // позиции — своей либо master. sellerId передаётся напрямую, а не AuthUser.
  async assertUsable(
    catalogItemId: string,
    sellerId: string | null,
  ): Promise<CatalogItem> {
    const item = await this.findOne(catalogItemId);
    if (item.status !== ReviewStatus.APPROVED) {
      throw new ForbiddenException('Позиция справочника ещё не одобрена');
    }
    if (item.sellerId && item.sellerId !== sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    return item;
  }
}
