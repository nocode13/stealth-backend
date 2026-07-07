import { Injectable, NotFoundException } from '@nestjs/common';
import { Seller, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SellersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Seller[]> {
    return this.prisma.seller.findMany({ orderBy: { createdAt: 'desc' } });
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
