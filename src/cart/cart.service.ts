import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Locale, ListingStatus, MediaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { withMediaUrls } from '../catalog/catalog-media.util';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';
import {
  CatalogItemResponse,
  toCatalogItemResponse,
} from '../catalog/catalog.response';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

const withListing = {
  listing: {
    include: {
      catalogItem: {
        include: {
          translations: true,
          category: { include: { translations: true } },
          // Корзина — экран покупателя, необработанное видео туда не попадает.
          media: {
            where: { status: MediaStatus.READY },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartItemWithListing = Prisma.CartItemGetPayload<{
  include: typeof withListing;
}>;

export interface CartItemResponse extends Omit<CartItemWithListing, 'listing'> {
  listing: Omit<CartItemWithListing['listing'], 'catalogItem'> & {
    catalogItem: CatalogItemResponse;
  };
}

export interface CartResponse {
  items: CartItemResponse[];
  itemCount: number;
  itemsTotal: number;
  deliveryFee: number;
  /** itemsTotal + deliveryFee — то, что заплатит покупатель. */
  total: number;
  freeDeliveryThreshold: number | null;
  amountUntilFreeDelivery: number;
  freeByWhitelist: boolean;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  async getCart(userId: string, locale: Locale): Promise<CartResponse> {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: withListing,
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponse(items, locale);
  }

  async addItem(
    userId: string,
    dto: AddCartItemDto,
    locale: Locale,
  ): Promise<CartResponse> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException(err(ERRORS.LISTING_NOT_FOUND));
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException(err(ERRORS.LISTING_UNAVAILABLE));
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_listingId: { userId, listingId: dto.listingId } },
    });
    const nextQuantity = (existing?.quantity ?? 0) + (dto.quantity ?? 1);
    if (nextQuantity > listing.stock) {
      throw new BadRequestException(err(ERRORS.NOT_ENOUGH_STOCK));
    }

    await this.prisma.cartItem.upsert({
      where: { userId_listingId: { userId, listingId: dto.listingId } },
      create: { userId, listingId: dto.listingId, quantity: nextQuantity },
      update: { quantity: nextQuantity },
    });
    return this.getCart(userId, locale);
  }

  async updateQuantity(
    userId: string,
    itemId: string,
    dto: UpdateCartItemDto,
    locale: Locale,
  ): Promise<CartResponse> {
    const item = await this.findOwned(userId, itemId);
    if (dto.quantity > item.listing.stock) {
      throw new BadRequestException(err(ERRORS.NOT_ENOUGH_STOCK));
    }
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });
    return this.getCart(userId, locale);
  }

  async removeItem(
    userId: string,
    itemId: string,
    locale: Locale,
  ): Promise<CartResponse> {
    await this.findOwned(userId, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(userId, locale);
  }

  async clearCart(userId: string, locale: Locale): Promise<CartResponse> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return this.getCart(userId, locale);
  }

  private async findOwned(
    userId: string,
    itemId: string,
  ): Promise<CartItemWithListing> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: withListing,
    });
    if (!item) throw new NotFoundException(err(ERRORS.CART_ITEM_NOT_FOUND));
    if (item.userId !== userId) {
      throw new ForbiddenException(err(ERRORS.FOREIGN_CART));
    }
    return item;
  }

  private async toResponse(
    items: CartItemWithListing[],
    locale: Locale,
  ): Promise<CartResponse> {
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const itemsTotal = items.reduce(
      (sum, item) => sum + item.listing.price * item.quantity,
      0,
    );
    // Пустая корзина — не «бесплатная»: without items every() был бы vacuously true.
    const allFreeDelivery =
      items.length > 0 &&
      items.every((i) => i.listing.catalogItem.freeDelivery);
    const quote = await this.settings.quote(itemsTotal, { allFreeDelivery });
    return {
      // catalogItem.media хранит ключи S3-объектов — здесь собираем полные URL.
      items: items.map((i) => ({
        ...i,
        listing: {
          ...i.listing,
          catalogItem: withMediaUrls(
            this.storage,
            toCatalogItemResponse(i.listing.catalogItem, locale),
          ),
        },
      })),
      itemCount,
      itemsTotal: quote.itemsTotal,
      deliveryFee: quote.deliveryFee,
      total: quote.total,
      freeDeliveryThreshold: quote.freeDeliveryThreshold,
      amountUntilFreeDelivery: quote.amountUntilFreeDelivery,
      freeByWhitelist: quote.freeByWhitelist,
    };
  }
}
