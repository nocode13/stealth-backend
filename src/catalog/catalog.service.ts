import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Locale,
  MediaStatus,
  MediaType,
  Prisma,
  ReviewStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CategoriesService } from '../categories/categories.service';
import { CacheService } from '../cache/cache.service';
import { withMediaUrls } from './catalog-media.util';
import { DEFAULT_LOCALE } from '../i18n/locale';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';
import { normalizeCatalogTranslations } from '../i18n/translations.util';
import {
  AdminCatalogItemResponse,
  CatalogItemResponse,
  CatalogItemWithTranslations,
  toAdminCatalogItemResponse,
  toCatalogItemResponse,
} from './catalog.response';
import {
  CreateCatalogItemDto,
  FindCatalogQueryDto,
  UpdateCatalogItemDto,
} from './dto/catalog.dto';

const MAX_MEDIA_PER_ITEM = 10;

// Админский include: медиа целиком, вместе с PROCESSING и FAILED — админка обязана
// показывать, что видео ещё обрабатывается или не обработалось.
const withCategory = {
  translations: true,
  category: { include: { translations: true } },
  media: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.CatalogItemInclude;

// Публичный include: недоделанное и упавшее видео на витрину не пускаем. Тот же
// фильтр повторяет ListingsService.withCatalog — витрина листингов ходит мимо
// CatalogService.
export const withCategoryPublic = {
  translations: true,
  category: { include: { translations: true } },
  media: {
    where: { status: MediaStatus.READY },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.CatalogItemInclude;

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  // В БД media.url/posterUrl хранят ключ S3-объекта — здесь собираем полный URL для
  // ответа. Кэш (findAll ниже) хранит сырые ключи: мэппинг применяется ПОСЛЕ
  // cache.wrap(), иначе смена S3_PUBLIC_URL потребовала бы бампа кэша.
  private withUrls<
    T extends { media: { url: string; posterUrl: string | null }[] },
  >(item: T): T {
    return withMediaUrls(this.storage, item);
  }

  // Витрина (мобилка): только одобренные позиции, master и чужие продавцы вперемешку.
  async findAll(
    query: FindCatalogQueryDto,
    locale: Locale,
  ): Promise<CursorPage<CatalogItemResponse>> {
    const page = await this.cache.wrap(
      'catalog',
      { ...query, locale },
      async () => {
        const rows = await this.prisma.catalogItemTranslation.findMany({
          where: {
            locale,
            catalogItem: {
              status: ReviewStatus.APPROVED,
              categoryId: query.noCategory ? null : query.categoryId,
              ...(query.search
                ? {
                    translations: {
                      some: {
                        name: { contains: query.search, mode: 'insensitive' },
                      },
                    },
                  }
                : {}),
            },
          },
          orderBy: [{ name: 'asc' }, { catalogItemId: 'asc' }],
          cursor: query.cursor
            ? { catalogItemId_locale: { catalogItemId: query.cursor, locale } }
            : undefined,
          skip: query.cursor ? 1 : 0,
          take: query.limit + 1,
          include: { catalogItem: { include: withCategoryPublic } },
        });
        const mapped = rows.map((t) =>
          toCatalogItemResponse(t.catalogItem, locale),
        );
        return toCursorPage(mapped, query.limit);
      },
    );
    return { ...page, items: page.items.map((i) => this.withUrls(i)) };
  }

  // Админка: SUPER_ADMIN видит всё (+ фильтры status/sellerId), SELLER — master
  // APPROVED + свои (любой статус); status/sellerId для SELLER игнорируются.
  // Строится от таблицы переводов на DEFAULT_LOCALE — тот же приём, что в findAll,
  // нужен ради сортировки по имени (Prisma не умеет orderBy по to-many).
  async findVisibleFor(
    user: AuthUser,
    query: FindCatalogQueryDto,
  ): Promise<CursorPage<AdminCatalogItemResponse>> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const locale = DEFAULT_LOCALE;
    const itemWhere: Prisma.CatalogItemWhereInput = {
      categoryId: query.noCategory ? null : query.categoryId,
      freeDelivery: query.freeDelivery ? true : undefined,
      ...(query.search
        ? {
            translations: {
              some: { name: { contains: query.search, mode: 'insensitive' } },
            },
          }
        : {}),
      ...(isSuperAdmin
        ? { status: query.status, sellerId: query.sellerId }
        : {
            OR: [
              { sellerId: null, status: ReviewStatus.APPROVED },
              { sellerId: user.sellerId ?? undefined },
            ],
          }),
    };
    const rows = await this.prisma.catalogItemTranslation.findMany({
      where: { locale, catalogItem: itemWhere },
      orderBy: [{ name: 'asc' }, { catalogItemId: 'asc' }],
      cursor: query.cursor
        ? { catalogItemId_locale: { catalogItemId: query.cursor, locale } }
        : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
      include: { catalogItem: { include: withCategory } },
    });
    const mapped = rows.map((t) => toAdminCatalogItemResponse(t.catalogItem));
    const page = toCursorPage(mapped, query.limit);
    return { ...page, items: page.items.map((i) => this.withUrls(i)) };
  }

  async findOne(id: string): Promise<AdminCatalogItemResponse> {
    return this.withUrls(toAdminCatalogItemResponse(await this.findRaw(id)));
  }

  private async findRaw(id: string): Promise<CatalogItemWithTranslations> {
    const item = await this.prisma.catalogItem.findUnique({
      where: { id },
      include: withCategory,
    });
    if (!item) throw new NotFoundException(err(ERRORS.CATALOG_ITEM_NOT_FOUND));
    return item;
  }

  async create(
    dto: CreateCatalogItemDto,
    user: AuthUser,
  ): Promise<AdminCatalogItemResponse> {
    if (dto.categoryId) {
      await this.categories.assertUsable(dto.categoryId, user);
    }
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    // Продавец не должен назначать себе бесплатную доставку за счёт платформы.
    if (!isSuperAdmin) delete dto.freeDelivery;
    const rows = normalizeCatalogTranslations(dto.translations);
    // Уникальных ограничений (кроме id) у позиции нет — позиции с одинаковым
    // названием допустимы, ловить P2002 больше не от чего.
    const created = await this.prisma.catalogItem.create({
      data: {
        categoryId: dto.categoryId,
        freeDelivery: dto.freeDelivery,
        sellerId: isSuperAdmin ? null : user.sellerId,
        status: isSuperAdmin ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
        translations: { create: rows },
      },
      include: withCategory,
    });
    await this.cache.bump();
    return this.withUrls(toAdminCatalogItemResponse(created));
  }

  async update(
    id: string,
    dto: UpdateCatalogItemDto,
    user: AuthUser,
  ): Promise<AdminCatalogItemResponse> {
    const item = await this.findRaw(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    if (dto.status !== undefined && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Недостаточно прав');
    }
    // Продавец не должен назначать себе бесплатную доставку за счёт платформы.
    if (user.role !== Role.SUPER_ADMIN) delete dto.freeDelivery;
    if (dto.categoryId) {
      await this.categories.assertUsable(dto.categoryId, user);
    }

    // dto.translations не пришёл (частичный PATCH) — переводы не трогаем вообще.
    const rows = dto.translations
      ? normalizeCatalogTranslations(dto.translations)
      : null;
    await this.prisma.$transaction([
      this.prisma.catalogItem.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          freeDelivery: dto.freeDelivery,
          status: dto.status,
        },
      }),
      ...(rows ?? []).map((r) =>
        this.prisma.catalogItemTranslation.upsert({
          where: {
            catalogItemId_locale: { catalogItemId: id, locale: r.locale },
          },
          create: { catalogItemId: id, ...r },
          update: {
            name: r.name,
            description: r.description,
            unit: r.unit,
            auto: r.auto,
          },
        }),
      ),
    ]);
    await this.cache.bump();
    return this.findOne(id);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const item = await this.findRaw(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    await this.prisma.catalogItem.delete({ where: { id } });
    await this.cache.bump();
  }

  private async assertOwned(
    id: string,
    user: AuthUser,
  ): Promise<CatalogItemWithTranslations> {
    const item = await this.findRaw(id);
    if (user.role !== Role.SUPER_ADMIN && item.sellerId !== user.sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    return item;
  }

  // Фото приходит уже готовым (webp), видео — ссылкой на оригинал со статусом
  // PROCESSING: mp4 и обложку дорисует MediaProcessingService.
  async addMedia(
    id: string,
    data: { url: string; type: MediaType; status: MediaStatus },
    user: AuthUser,
  ): Promise<{ item: AdminCatalogItemResponse; mediaId: string }> {
    const item = await this.assertOwned(id, user);
    if (item.media.length >= MAX_MEDIA_PER_ITEM) {
      throw new ForbiddenException(
        `Не больше ${MAX_MEDIA_PER_ITEM} медиафайлов на позицию`,
      );
    }
    const nextSortOrder = item.media.length
      ? Math.max(...item.media.map((m) => m.sortOrder)) + 1
      : 0;
    const created = await this.prisma.catalogItemMedia.create({
      data: { catalogItemId: id, ...data, sortOrder: nextSortOrder },
    });
    await this.cache.bump();
    return { item: await this.findOne(id), mediaId: created.id };
  }

  async removeMedia(
    id: string,
    mediaId: string,
    user: AuthUser,
  ): Promise<AdminCatalogItemResponse> {
    // Только проверка владения/существования — media() отсюда не используется:
    // findOne() (через assertOwned) отдаёт уже собранные URL, а для удаления объекта
    // в S3 нужен именно ключ, поэтому он берётся отдельным запросом ниже.
    await this.assertOwned(id, user);
    const media = await this.prisma.catalogItemMedia.findFirst({
      where: { id: mediaId, catalogItemId: id },
    });
    if (!media) throw new NotFoundException('Медиафайл не найден');

    // У видео объектов в бакете два: сам файл и обложка (у PROCESSING в url лежит
    // ещё не обработанный оригинал — его тоже надо убрать).
    for (const key of [media.url, media.posterUrl]) {
      if (!key) continue;
      this.storage.delete(key).catch((e: unknown) => {
        this.logger.warn(`Не удалось удалить объект ${key}`, e);
      });
    }

    await this.prisma.catalogItemMedia.delete({ where: { id: mediaId } });
    await this.cache.bump();
    return this.findOne(id);
  }

  async reorderMedia(
    id: string,
    mediaId: string,
    direction: 'up' | 'down',
    user: AuthUser,
  ): Promise<AdminCatalogItemResponse> {
    const item = await this.assertOwned(id, user);
    const media = item.media; // уже отсортированы по sortOrder
    const index = media.findIndex((m) => m.id === mediaId);
    if (index === -1) throw new NotFoundException('Медиафайл не найден');

    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= media.length) {
      return this.withUrls(toAdminCatalogItemResponse(item));
    }

    const a = media[index];
    const b = media[swapWith];
    await this.prisma.$transaction([
      this.prisma.catalogItemMedia.update({
        where: { id: a.id },
        data: { sortOrder: b.sortOrder },
      }),
      this.prisma.catalogItemMedia.update({
        where: { id: b.id },
        data: { sortOrder: a.sortOrder },
      }),
    ]);
    await this.cache.bump();
    return this.findOne(id);
  }

  // Используется ListingsService: продавец может продавать только по одобренной
  // позиции — своей либо master. sellerId передаётся напрямую, а не AuthUser.
  // ⚠️ Возвращает внутренний тип с переводами: вызывающему (ListingsService.create)
  // нужны только status/sellerId, поля переводов там не читаются.
  async assertUsable(
    catalogItemId: string,
    sellerId: string | null,
  ): Promise<CatalogItemWithTranslations> {
    const item = await this.findRaw(catalogItemId);
    if (item.status !== ReviewStatus.APPROVED) {
      throw new ForbiddenException('Позиция справочника ещё не одобрена');
    }
    if (item.sellerId && item.sellerId !== sellerId) {
      throw new ForbiddenException('Чужая позиция справочника');
    }
    return item;
  }
}
