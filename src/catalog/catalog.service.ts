import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(search?: string): Promise<CatalogItem[]> {
    return this.prisma.catalogItem.findMany({
      where: search
        ? { name: { contains: search, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<CatalogItem> {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Позиция справочника не найдена');
    return item;
  }

  create(dto: CreateCatalogItemDto): Promise<CatalogItem> {
    return this.prisma.catalogItem.create({ data: dto });
  }

  async update(id: string, dto: UpdateCatalogItemDto): Promise<CatalogItem> {
    await this.findOne(id);
    return this.prisma.catalogItem.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.catalogItem.delete({ where: { id } });
  }
}
