import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CatalogItem, Prisma, ReviewStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CategoriesService } from '../categories/categories.service';
import {
  CreateCatalogItemDto,
  FindCatalogQueryDto,
  UpdateCatalogItemDto,
} from './dto/catalog.dto';

const withCategory = {
  category: true,
} satisfies Prisma.CatalogItemInclude;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  // Витрина (мобилка): только одобренные позиции, master и чужие продавцы вперемешку.
  async findAll(query: FindCatalogQueryDto): Promise<CursorPage<CatalogItem>> {
    const rows = await this.prisma.catalogItem.findMany({
      where: {
        status: ReviewStatus.APPROVED,
        name: query.search
          ? { contains: query.search, mode: 'insensitive' }
          : undefined,
        categoryId: query.categoryId,
      },
      include: withCategory,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
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
      categoryId: query.categoryId,
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
    await this.categories.assertUsable(dto.categoryId, user.sellerId);
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    return this.prisma.catalogItem.create({
      data: {
        ...dto,
        sellerId: isSuperAdmin ? null : user.sellerId,
        status: isSuperAdmin ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
      },
      include: withCategory,
    });
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
    if (dto.categoryId) {
      await this.categories.assertUsable(dto.categoryId, user.sellerId);
    }
    return this.prisma.catalogItem.update({
      where: { id },
      data: dto,
      include: withCategory,
    });
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const item = await this.findOne(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    await this.prisma.catalogItem.delete({ where: { id } });
  }

  async updateStatus(id: string, status: ReviewStatus): Promise<CatalogItem> {
    await this.findOne(id);
    return this.prisma.catalogItem.update({
      where: { id },
      data: { status },
      include: withCategory,
    });
  }

  async updateImage(
    id: string,
    imageUrl: string,
    user: AuthUser,
  ): Promise<CatalogItem> {
    const item = await this.findOne(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    return this.prisma.catalogItem.update({
      where: { id },
      data: { imageUrl },
      include: withCategory,
    });
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
