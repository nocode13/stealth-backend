import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Locale, Prisma, ReviewStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CacheService } from '../cache/cache.service';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';
import { normalizeCategoryTranslations } from '../i18n/translations.util';
import {
  AdminCategoryResponse,
  CategoryResponse,
  CategoryWithTranslations,
  toAdminCategoryResponse,
} from './category.response';
import {
  CreateCategoryDto,
  FindCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

const withTranslations = {
  translations: true,
} satisfies Prisma.CategoryInclude;

// Ищем по ЛЮБОЙ локали: покупатель может искать русское слово на узбекском интерфейсе.
function searchFilter(search?: string): Prisma.CategoryWhereInput | undefined {
  if (!search) return undefined;
  return {
    translations: { some: { name: { contains: search, mode: 'insensitive' } } },
  };
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // Видимость: SUPER_ADMIN видит всё (+ фильтры status/sellerId), SELLER — master
  // APPROVED + свои (любой статус); status/sellerId для SELLER игнорируются, чтобы
  // не обойти правило видимости.
  async findVisibleFor(
    user: AuthUser,
    query: FindCategoriesQueryDto,
  ): Promise<CursorPage<AdminCategoryResponse>> {
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
      include: withTranslations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return { ...page, items: page.items.map(toAdminCategoryResponse) };
  }

  // Витрина (мобилка): только одобренные категории, master и продавцов вперемешку.
  async findStorefront(
    query: FindCategoriesQueryDto,
    locale: Locale,
  ): Promise<CursorPage<CategoryResponse>> {
    // locale ОБЯЗАН быть в params: ключ кэша считается только по ним (см. И3).
    return this.cache.wrap('categories', { ...query, locale }, async () => {
      const rows = await this.prisma.categoryTranslation.findMany({
        where: {
          locale,
          category: {
            status: ReviewStatus.APPROVED,
            ...searchFilter(query.search),
          },
        },
        // Сортировка по имени возможна только отсюда: Prisma не умеет orderBy по to-many.
        orderBy: [{ name: 'asc' }, { categoryId: 'asc' }],
        cursor: query.cursor
          ? { categoryId_locale: { categoryId: query.cursor, locale } }
          : undefined,
        skip: query.cursor ? 1 : 0,
        take: query.limit + 1,
        include: { category: true },
      });
      // Курсор остаётся id КАТЕГОРИИ — контракт CursorPage не меняется.
      const mapped: CategoryResponse[] = rows.map((t) => ({
        id: t.categoryId,
        name: t.name,
        sellerId: t.category.sellerId,
        status: t.category.status,
        createdAt: t.category.createdAt,
        updatedAt: t.category.updatedAt,
      }));
      return toCursorPage(mapped, query.limit);
    });
  }

  async findOne(id: string): Promise<AdminCategoryResponse> {
    return toAdminCategoryResponse(await this.findRaw(id));
  }

  private async findRaw(id: string): Promise<CategoryWithTranslations> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: withTranslations,
    });
    if (!category) throw new NotFoundException(err(ERRORS.CATEGORY_NOT_FOUND));
    return category;
  }

  // Проверяет, что categoryId виден и доступен для использования продавцом
  // (master APPROVED либо собственная APPROVED-категория продавца).
  // SUPER_ADMIN проходит проверку владения всегда — та же логика, что и в
  // остальных проверках владения в CatalogService/CategoriesService.
  async assertUsable(
    categoryId: string,
    user: AuthUser,
  ): Promise<CategoryWithTranslations> {
    const category = await this.findRaw(categoryId);
    if (category.status !== ReviewStatus.APPROVED) {
      throw new ForbiddenException('Категория ещё не одобрена');
    }
    if (
      user.role !== Role.SUPER_ADMIN &&
      category.sellerId &&
      category.sellerId !== user.sellerId
    ) {
      throw new ForbiddenException('Чужая категория продавца');
    }
    return category;
  }

  async create(
    dto: CreateCategoryDto,
    user: AuthUser,
  ): Promise<AdminCategoryResponse> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const rows = normalizeCategoryTranslations(dto.translations);
    const created = await this.prisma.category.create({
      data: {
        sellerId: isSuperAdmin ? null : user.sellerId,
        status: isSuperAdmin ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
        translations: { create: rows },
      },
      include: withTranslations,
    });
    await this.cache.bump();
    return toAdminCategoryResponse(created);
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    user: AuthUser,
  ): Promise<AdminCategoryResponse> {
    const category = await this.findRaw(id);
    if (user.role !== Role.SUPER_ADMIN && category.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая категория продавца');
    }
    if (dto.status !== undefined && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Недостаточно прав');
    }

    // dto.translations не пришёл (частичный PATCH) — переводы не трогаем вообще.
    const rows = dto.translations
      ? normalizeCategoryTranslations(dto.translations)
      : null;
    await this.prisma.$transaction([
      this.prisma.category.update({
        where: { id },
        data: { status: dto.status },
      }),
      ...(rows ?? []).map((r) =>
        this.prisma.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId: id, locale: r.locale } },
          create: { categoryId: id, ...r },
          update: { name: r.name, auto: r.auto },
        }),
      ),
    ]);
    await this.cache.bump();
    return this.findOne(id);
  }

  async updateStatus(
    id: string,
    status: ReviewStatus,
  ): Promise<AdminCategoryResponse> {
    await this.findRaw(id);
    const updated = await this.prisma.category.update({
      where: { id },
      data: { status },
      include: withTranslations,
    });
    await this.cache.bump();
    return toAdminCategoryResponse(updated);
  }
}
