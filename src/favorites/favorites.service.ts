import { Injectable, NotFoundException } from '@nestjs/common';
import { Locale } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { withMediaUrls } from '../catalog/catalog-media.util';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import {
  ListingCardResponse,
  mobileListingInclude,
  toListingCard,
} from '../listings/mobile-listing';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Дешёвый запрос под heart/liked-state на клиенте — без include листинга.
  async listIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      select: { listingId: true },
    });
    return rows.map((r) => r.listingId);
  }

  // Персональные данные — cache.wrap здесь НЕ используется (это не витрина, шарить
  // между пользователями нельзя). Архивные/распроданные листинги не фильтруются:
  // избранное обязано показывать их тоже, клиент помечает их по `available: false`.
  async list(
    userId: string,
    query: CursorPaginationDto,
    locale: Locale,
  ): Promise<CursorPage<ListingCardResponse>> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      include: { listing: { include: mobileListingInclude } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    // toCursorPage режет по id — здесь это ещё id Favorite (курсор страницы), не
    // листинга: слайс и nextCursor считаются ДО мэппинга в карточку.
    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      items: page.items.map((f) =>
        withMediaUrls(this.storage, toListingCard(f.listing, locale)),
      ),
    };
  }

  async add(userId: string, listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException(err(ERRORS.LISTING_NOT_FOUND));

    // upsert — идемпотентно: повторный лайк того же листинга не плодит дубли и не падает.
    await this.prisma.favorite.upsert({
      where: { userId_listingId: { userId, listingId } },
      create: { userId, listingId },
      update: {},
    });
  }

  async remove(userId: string, listingId: string): Promise<void> {
    // deleteMany — идемпотентно: снять лайк с уже не-избранного листинга не ошибка.
    await this.prisma.favorite.deleteMany({ where: { userId, listingId } });
  }
}
