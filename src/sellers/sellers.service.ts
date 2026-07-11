import { Injectable, NotFoundException } from '@nestjs/common';
import { Seller, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { FindSellersQueryDto } from './dto/seller.dto';

@Injectable()
export class SellersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindSellersQueryDto): Promise<CursorPage<Seller>> {
    const rows = await this.prisma.seller.findMany({
      where: {
        status: query.status,
        name: query.search
          ? { contains: query.search, mode: 'insensitive' }
          : undefined,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toCursorPage(rows, query.limit);
  }

  async findOne(id: string): Promise<Seller> {
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) throw new NotFoundException('Продавец не найден');
    return seller;
  }

  updateStatus(id: string, status: SellerStatus): Promise<Seller> {
    return this.prisma.seller.update({ where: { id }, data: { status } });
  }
}
