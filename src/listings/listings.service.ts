import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Listing, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto';

const withCatalog = {
  catalogItem: true,
} satisfies Prisma.ListingInclude;

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Витрина мобилки: только активные листинги.
  findStorefront(search?: string): Promise<Listing[]> {
    return this.prisma.listing.findMany({
      where: {
        status: ListingStatus.ACTIVE,
        stock: { gt: 0 },
        catalogItem: search
          ? { name: { contains: search, mode: 'insensitive' } }
          : undefined,
      },
      include: withCatalog,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Листинги конкретного продавца (админка).
  findForSeller(sellerId: string): Promise<Listing[]> {
    return this.prisma.listing.findMany({
      where: { sellerId },
      include: withCatalog,
      orderBy: { createdAt: 'desc' },
    });
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

  create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
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
