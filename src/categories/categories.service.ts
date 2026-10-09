import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Locale, Prisma, ReviewStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';
import { ImageService } from '../storage/image.service';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';
import { normalizeNameTranslations } from '../i18n/translations.util';
import {
  AdminCategoryResponse,
  CategoryResponse,
  CategoryWithTranslations,
  adminCategoryInclude,
  toAdminCategoryResponse,
  toCategoryResponse,
} from './category.response';
import {
  CreateCategoryDto,
  FindCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

// Сколько уровней у дерева: категория товаров → подкатегория. Третий уровень — смена
// этой константы и UI, не модели.
export const MAX_CATEGORY_DEPTH = 2;

// Иконка — плитка на главной мобилки, крупнее 256px ей не нужно.
const ICON_MAX_SIDE = 256;

// Ищем по ЛЮБОЙ локали: покупатель может искать русское слово на узбекском интерфейсе.
function searchFilter(search?: string): Prisma.CategoryWhereInput | undefined {
  if (!search) return undefined;
  return {
    translations: { some: { name: { contains: search, mode: 'insensitive' } } },
  };
}

// root=true → только верхний уровень, иначе parentId (если пришёл).
function levelFilter(query: FindCategoriesQueryDto): Prisma.CategoryWhereInput {
  if (query.root) return { parentId: null };
  return query.parentId ? { parentId: query.parentId } : {};
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
  ) {}

  // В БД iconKey — ключ S3-объекта. Полный URL собирается ПОСЛЕ cache.wrap, иначе
  // смена S3_PUBLIC_URL потребовала бы бампа кэша.
  private withIconUrl<T extends { iconUrl: string | null }>(c: T): T {
    return { ...c, iconUrl: this.storage.getUrlOrNull(c.iconUrl) };
  }

  // Видимость: SUPER_ADMIN видит всё (+ фильтры status/sellerId), SELLER — master
  // APPROVED + свои (любой статус); status/sellerId для SELLER игнорируются, чтобы
  // не обойти правило видимости.
  async findVisibleFor(
    user: AuthUser,
    query: FindCategoriesQueryDto,
  ): Promise<CursorPage<AdminCategoryResponse>> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const filters = [searchFilter(query.search), levelFilter(query)].filter(
      Boolean,
    ) as Prisma.CategoryWhereInput[];
    const where: Prisma.CategoryWhereInput = isSuperAdmin
      ? { AND: filters, status: query.status, sellerId: query.sellerId }
      : {
          AND: [
            ...filters,
            {
              OR: [
                { sellerId: null, status: ReviewStatus.APPROVED },
                { sellerId: user.sellerId ?? undefined },
              ],
            },
          ],
        };
    const rows = await this.prisma.category.findMany({
      where,
      include: adminCategoryInclude,
      // Верхний уровень — в порядке плиток мобилки, остальное — новые сверху.
      orderBy: query.root
        ? [{ position: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      items: page.items.map((c) =>
        this.withIconUrl(toAdminCategoryResponse(c)),
      ),
    };
  }

  // Витрина (мобилка): только одобренные, master и продавцов вперемешку.
  // Без parentId — категории товаров (плитки главной) в порядке position; с
  // parentId — его подкатегории по имени (фильтр экрана категории).
  async findStorefront(
    query: FindCategoriesQueryDto,
    locale: Locale,
  ): Promise<CursorPage<CategoryResponse>> {
    // locale ОБЯЗАН быть в params: ключ кэша считается только по ним (см. И3).
    const page = await this.cache.wrap(
      'categories',
      { ...query, locale },
      () =>
        query.parentId
          ? this.findStorefrontChildren(query, query.parentId, locale)
          : this.findStorefrontRoots(query, locale),
    );
    return { ...page, items: page.items.map((c) => this.withIconUrl(c)) };
  }

  private async findStorefrontRoots(
    query: FindCategoriesQueryDto,
    locale: Locale,
  ): Promise<CursorPage<CategoryResponse>> {
    const rows = await this.prisma.category.findMany({
      where: {
        parentId: null,
        status: ReviewStatus.APPROVED,
        ...searchFilter(query.search),
      },
      include: { translations: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(
      rows.map((c) => toCategoryResponse(c, locale)),
      query.limit,
    );
  }

  private async findStorefrontChildren(
    query: FindCategoriesQueryDto,
    parentId: string,
    locale: Locale,
  ): Promise<CursorPage<CategoryResponse>> {
    const rows = await this.prisma.categoryTranslation.findMany({
      where: {
        locale,
        category: {
          parentId,
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
      include: { category: { include: { translations: true } } },
    });
    // Курсор остаётся id КАТЕГОРИИ — контракт CursorPage не меняется.
    return toCursorPage(
      rows.map((t) => ({
        ...toCategoryResponse(t.category, locale),
        name: t.name,
      })),
      query.limit,
    );
  }

  // Экран категории в мобилке открывается по code (диплинк /c/houseplants).
  async findOneStorefront(
    code: string,
    locale: Locale,
  ): Promise<CategoryResponse> {
    const category = await this.cache.wrap(
      'category',
      { code, locale },
      async () => {
        const found = await this.prisma.category.findFirst({
          where: { code, parentId: null, status: ReviewStatus.APPROVED },
          include: { translations: true },
        });
        // Промах в БД не кешируется: исключение из колбэка wrap пробрасывает как есть.
        if (!found) throw new NotFoundException(err(ERRORS.CATEGORY_NOT_FOUND));
        return toCategoryResponse(found, locale);
      },
    );
    return this.withIconUrl(category);
  }

  async findOne(id: string): Promise<AdminCategoryResponse> {
    return this.withIconUrl(toAdminCategoryResponse(await this.findRaw(id)));
  }

  private async findRaw(id: string): Promise<CategoryWithTranslations> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: adminCategoryInclude,
    });
    if (!category) throw new NotFoundException(err(ERRORS.CATEGORY_NOT_FOUND));
    return category;
  }

  // Уровень категории: 1 — верхний. Идёт вверх по parentId; при MAX_CATEGORY_DEPTH = 2
  // это максимум один лишний запрос.
  private async depthOf(category: { parentId: string | null }): Promise<number> {
    let depth = 1;
    let parentId = category.parentId;
    while (parentId) {
      depth += 1;
      const parent = await this.prisma.category.findUnique({
        where: { id: parentId },
        select: { parentId: true },
      });
      parentId = parent?.parentId ?? null;
    }
    return depth;
  }

  // Любая смена статуса категории запрещена, пока к ней привязана хотя бы одна
  // позиция каталога (на любом уровне) или подкатегория: сначала отвяжите их.
  private async assertStatusChangeAllowed(
    id: string,
    currentStatus: ReviewStatus,
    nextStatus: ReviewStatus | undefined,
  ): Promise<void> {
    if (nextStatus === undefined || nextStatus === currentStatus) return;
    const [items, children] = await Promise.all([
      this.prisma.catalogItem.count({
        where: { OR: [{ categoryId: id }, { subcategoryId: id }] },
      }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);
    if (items > 0) {
      throw new ConflictException(
        `Нельзя менять статус категории: к ней привязано позиций каталога — ${items}. Сначала отвяжите их.`,
      );
    }
    if (children > 0) {
      throw new ConflictException(
        `Нельзя менять статус категории: у неё подкатегорий — ${children}.`,
      );
    }
  }

  // Проверяет, что категория видна и доступна для использования продавцом
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

  // Пара категорий позиции каталога: categoryId — верхний уровень, subcategoryId
  // (если есть) — его прямой ребёнок. Обе обязаны быть доступны пользователю.
  async assertUsableForItem(
    categoryId: string,
    subcategoryId: string | null | undefined,
    user: AuthUser,
  ): Promise<void> {
    const category = await this.assertUsable(categoryId, user);
    if (category.parentId !== null) {
      throw new BadRequestException(
        'categoryId должен быть категорией верхнего уровня',
      );
    }
    if (!subcategoryId) return;
    const subcategory = await this.assertUsable(subcategoryId, user);
    if (subcategory.parentId !== category.id) {
      throw new BadRequestException(
        'Подкатегория не относится к выбранной категории',
      );
    }
  }

  async create(
    dto: CreateCategoryDto,
    user: AuthUser,
  ): Promise<AdminCategoryResponse> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    if (dto.parentId) {
      if (dto.code) {
        throw new BadRequestException(
          'code задаётся только категории верхнего уровня',
        );
      }
      // Родитель должен быть доступен: продавец не вешает свою подкатегорию на
      // чужую или неодобренную категорию.
      const parent = await this.assertUsable(dto.parentId, user);
      if ((await this.depthOf(parent)) >= MAX_CATEGORY_DEPTH) {
        throw new BadRequestException(
          'Подкатегорию можно создать только в категории верхнего уровня',
        );
      }
    } else {
      if (!isSuperAdmin) {
        throw new ForbiddenException(
          'Категорию товаров создаёт только супер-админ',
        );
      }
      if (!dto.code) {
        throw new BadRequestException(
          'code обязателен у категории верхнего уровня',
        );
      }
    }
    if (dto.position !== undefined && !isSuperAdmin) {
      throw new ForbiddenException('Недостаточно прав');
    }

    const rows = normalizeNameTranslations(dto.translations);
    try {
      const created = await this.prisma.category.create({
        data: {
          parentId: dto.parentId,
          code: dto.code,
          position: dto.position,
          sellerId: isSuperAdmin ? null : user.sellerId,
          status: isSuperAdmin ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
          translations: { create: rows },
        },
        include: adminCategoryInclude,
      });
      await this.cache.bump();
      return this.withIconUrl(toAdminCategoryResponse(created));
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`Код «${dto.code}» уже занят`);
      }
      throw e;
    }
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
    if (
      (dto.status !== undefined ||
        dto.code !== undefined ||
        dto.position !== undefined) &&
      user.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException('Недостаточно прав');
    }
    if (dto.code !== undefined && category.parentId !== null) {
      throw new BadRequestException(
        'code задаётся только категории верхнего уровня',
      );
    }
    await this.assertStatusChangeAllowed(id, category.status, dto.status);

    // dto.translations не пришёл (частичный PATCH) — переводы не трогаем вообще.
    const rows = dto.translations
      ? normalizeNameTranslations(dto.translations)
      : null;
    try {
      await this.prisma.$transaction([
        this.prisma.category.update({
          where: { id },
          data: { status: dto.status, code: dto.code, position: dto.position },
        }),
        ...(rows ?? []).map((r) =>
          this.prisma.categoryTranslation.upsert({
            where: { categoryId_locale: { categoryId: id, locale: r.locale } },
            create: { categoryId: id, ...r },
            update: { name: r.name, auto: r.auto },
          }),
        ),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`Код «${dto.code}» уже занят`);
      }
      throw e;
    }
    await this.cache.bump();
    return this.findOne(id);
  }

  async updateStatus(
    id: string,
    status: ReviewStatus,
  ): Promise<AdminCategoryResponse> {
    const category = await this.findRaw(id);
    await this.assertStatusChangeAllowed(id, category.status, status);
    const updated = await this.prisma.category.update({
      where: { id },
      data: { status },
      include: adminCategoryInclude,
    });
    await this.cache.bump();
    return this.withIconUrl(toAdminCategoryResponse(updated));
  }

  // Иконка плитки — только у категории верхнего уровня. Проверка до загрузки,
  // чтобы не оставлять в бакете объект-сироту.
  async uploadIcon(id: string, file: Buffer): Promise<AdminCategoryResponse> {
    const category = await this.findRaw(id);
    if (category.parentId !== null) {
      throw new BadRequestException(
        'Иконка есть только у категории верхнего уровня',
      );
    }
    // Расширение и Content-Type — из результата конвертации, не из originalname.
    const { buffer, contentType, ext } = await this.image.toWebp(file, {
      maxSide: ICON_MAX_SIDE,
    });
    const key = `categories/${id}-${Date.now()}.${ext}`;
    await this.storage.upload(key, buffer, contentType);

    const oldKey = category.iconKey;
    if (oldKey) {
      this.storage.delete(oldKey).catch((e: unknown) => {
        this.logger.warn(`Не удалось удалить старую иконку ${oldKey}`, e);
      });
    }
    await this.prisma.category.update({
      where: { id },
      data: { iconKey: key },
    });
    await this.cache.bump();
    return this.findOne(id);
  }
}
