import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, Prisma, ReviewStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import {
  CreateCategoryDto,
  FindCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

// OR по всем локалям названия — поиска по категориям раньше не было вообще.
function searchFilter(search?: string): Prisma.CategoryWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: 'insensitive' as const };
  return {
    OR: [
      { nameRu: contains },
      { nameUz: contains },
      { nameEn: contains },
      { nameKaa: contains },
    ],
  };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // Видимость: SUPER_ADMIN видит всё (+ фильтры status/sellerId), SELLER — master
  // APPROVED + свои (любой статус); status/sellerId для SELLER игнорируются, чтобы
  // не обойти правило видимости.
  async findVisibleFor(
    user: AuthUser,
    query: FindCategoriesQueryDto,
  ): Promise<CursorPage<Category>> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const search = searchFilter(query.search);
    const where: Prisma.CategoryWhereInput = isSuperAdmin
      ? { ...search, status: query.status, sellerId: query.sellerId }
      : {
          AND: [
            search,
            {
              OR: [
                { sellerId: null, status: ReviewStatus.APPROVED },
                { sellerId: user.sellerId ?? undefined },
              ],
            },
          ].filter(Boolean) as Prisma.CategoryWhereInput[],
        };
    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  // Витрина (мобилка): только одобренные категории, master и продавцов вперемешку.
  async findStorefront(
    query: FindCategoriesQueryDto,
  ): Promise<CursorPage<Category>> {
    const rows = await this.prisma.category.findMany({
      where: { status: ReviewStatus.APPROVED, ...searchFilter(query.search) },
      orderBy: [{ nameRu: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOne(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Категория не найдена');
    return category;
  }

  // Проверяет, что categoryId виден и доступен для использования продавцом
  // (master APPROVED либо собственная APPROVED-категория продавца). sellerId
  // передаётся напрямую (а не AuthUser), т.к. используется и из других
  // доменных сервисов (CatalogService, ListingsService).
  async assertUsable(
    categoryId: string,
    sellerId: string | null,
  ): Promise<Category> {
    const category = await this.findOne(categoryId);
    if (category.status !== ReviewStatus.APPROVED) {
      throw new ForbiddenException('Категория ещё не одобрена');
    }
    if (category.sellerId && category.sellerId !== sellerId) {
      throw new ForbiddenException('Чужая категория продавца');
    }
    return category;
  }

  create(dto: CreateCategoryDto, user: AuthUser): Promise<Category> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    return this.prisma.category.create({
      data: {
        ...dto,
        sellerId: isSuperAdmin ? null : user.sellerId,
        status: isSuperAdmin ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
      },
    });
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    user: AuthUser,
  ): Promise<Category> {
    const category = await this.findOne(id);
    if (user.role !== Role.SUPER_ADMIN && category.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая категория продавца');
    }
    if (dto.status !== undefined && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async updateStatus(id: string, status: ReviewStatus): Promise<Category> {
    await this.findOne(id);
    return this.prisma.category.update({ where: { id }, data: { status } });
  }
}
