import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, Seller, SellerStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CacheService } from '../cache/cache.service';
import {
  CreateSellerDto,
  FindSellersQueryDto,
  UpdateSellerDto,
} from './dto/seller.dto';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  // bannerUrl в БД хранится как ключ S3-объекта — здесь собираем полный URL для ответа.
  private withUrl(seller: Seller): Seller {
    return {
      ...seller,
      bannerUrl: this.storage.getUrlOrNull(seller.bannerUrl),
    };
  }

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
    const page = toCursorPage(rows, query.limit);
    return { ...page, items: page.items.map((s) => this.withUrl(s)) };
  }

  async findOne(id: string): Promise<Seller> {
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) throw new NotFoundException('Продавец не найден');
    return this.withUrl(seller);
  }

  // Витрина мобилки: только ACTIVE продавцы (SUSPENDED/PENDING не показываем).
  async findOnePublic(id: string): Promise<Seller> {
    const seller = await this.cache.wrap('seller', id, async () => {
      const found = await this.prisma.seller.findUnique({
        where: { id, status: SellerStatus.ACTIVE },
      });
      if (!found) throw new NotFoundException('Продавец не найден');
      return found;
    });
    return this.withUrl(seller);
  }

  // Продавца заводит только SUPER_ADMIN. Владелец — новый User(role: SELLER),
  // логинится в админку по email+паролю, как и остальной staff. sellerId владельцу
  // проставляется вторым шагом: Seller.ownerUserId для него ещё не существует,
  // пока сам продавец не создан, а весь остальной код (groupStaffScope в заказах,
  // видимость категорий/каталога) скоупит SELLER именно по User.sellerId.
  async create(dto: CreateSellerDto): Promise<Seller> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const passwordHash = await bcrypt.hash(dto.ownerPassword, 10);
        const owner = await tx.user.create({
          data: {
            email: dto.ownerEmail,
            phone: dto.ownerPhone,
            passwordHash,
            role: Role.SELLER,
          },
        });
        const seller = await tx.seller.create({
          data: {
            name: dto.name,
            description: dto.description,
            ownerUserId: owner.id,
          },
        });
        await tx.user.update({
          where: { id: owner.id },
          data: { sellerId: seller.id },
        });
        return seller;
      });
      await this.cache.bump();
      return this.withUrl(created);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const target = (e.meta?.target as string[] | undefined) ?? [];
        const field = target.includes('phone')
          ? 'Этот телефон'
          : target.includes('email')
            ? 'Этот email'
            : 'Эти данные';
        throw new ConflictException(`${field} уже привязан к другому аккаунту`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateSellerDto): Promise<Seller> {
    const updated = await this.prisma.seller.update({
      where: { id },
      data: dto,
    });
    await this.cache.bump();
    return this.withUrl(updated);
  }

  async updateBanner(id: string, bannerKey: string): Promise<Seller> {
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) {
      throw new NotFoundException('Продавец не найден');
    }

    const oldBannerKey = seller.bannerUrl;
    if (oldBannerKey) {
      this.storage.delete(oldBannerKey).catch((e: unknown) => {
        this.logger.warn(`Не удалось удалить старый баннер ${oldBannerKey}`, e);
      });
    }

    const updated = await this.prisma.seller.update({
      where: { id },
      data: { bannerUrl: bannerKey },
    });
    await this.cache.bump();
    return this.withUrl(updated);
  }
}
