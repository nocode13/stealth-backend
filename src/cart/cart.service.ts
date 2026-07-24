import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

const withListing = {
  listing: { include: { catalogItem: { include: { category: true } } } },
} satisfies Prisma.CartItemInclude;

type CartItemWithListing = Prisma.CartItemGetPayload<{
  include: typeof withListing;
}>;

export interface CartResponse {
  items: CartItemWithListing[];
  itemCount: number;
  total: number;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string): Promise<CartResponse> {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: withListing,
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponse(items);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartResponse> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException('Листинг не найден');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Листинг недоступен');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_listingId: { userId, listingId: dto.listingId } },
    });
    const nextQuantity = (existing?.quantity ?? 0) + (dto.quantity ?? 1);
    if (nextQuantity > listing.stock) {
      throw new BadRequestException('Недостаточно товара на складе');
    }

    await this.prisma.cartItem.upsert({
      where: { userId_listingId: { userId, listingId: dto.listingId } },
      create: { userId, listingId: dto.listingId, quantity: nextQuantity },
      update: { quantity: nextQuantity },
    });
    return this.getCart(userId);
  }

  async updateQuantity(
    userId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponse> {
    const item = await this.findOwned(userId, itemId);
    if (dto.quantity > item.listing.stock) {
      throw new BadRequestException('Недостаточно товара на складе');
    }
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartResponse> {
    await this.findOwned(userId, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<CartResponse> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return this.getCart(userId);
  }

  private async findOwned(
    userId: string,
    itemId: string,
  ): Promise<CartItemWithListing> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: withListing,
    });
    if (!item) throw new NotFoundException('Позиция корзины не найдена');
    if (item.userId !== userId) {
      throw new ForbiddenException('Чужая корзина');
    }
    return item;
  }

  private toResponse(items: CartItemWithListing[]): CartResponse {
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const total = items.reduce(
      (sum, item) => sum + item.listing.price * item.quantity,
      0,
    );
    return { items, itemCount, total };
  }
}
