import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Locale, Prisma, Role, SellerStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CacheService } from '../cache/cache.service';
import { err } from '../i18n/api-error';
import { ERRORS } from '../i18n/messages';
import { normalizeSellerTranslations } from '../i18n/translations.util';
import {
  AdminSellerResponse,
  SellerResponse,
  toAdminSellerResponse,
  toSellerResponse,
} from './seller.response';
import {
  CreateSellerDto,
  FindSellersQueryDto,
  UpdateSellerDto,
} from './dto/seller.dto';

const withTranslations = { translations: true } satisfies Prisma.SellerInclude;

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  // bannerUrl в БД хранится как ключ S3-объекта — здесь собираем полный URL для ответа.
  private withUrl<T extends { bannerUrl: string | null }>(seller: T): T {
    return {
      ...seller,
      bannerUrl: this.storage.getUrlOrNull(seller.bannerUrl),
    };
  }

  async findAll(
    query: FindSellersQueryDto,
  ): Promise<CursorPage<AdminSellerResponse>> {
    const rows = await this.prisma.seller.findMany({
      where: {
        status: query.status,
        ...(query.search
          ? {
              translations: {
                some: { name: { contains: query.search, mode: 'insensitive' } },
              },
            }
          : {}),
      },
      include: withTranslations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      items: page.items.map((s) => this.withUrl(toAdminSellerResponse(s))),
    };
  }

  async findOne(id: string): Promise<AdminSellerResponse> {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      include: withTranslations,
    });
    if (!seller) throw new NotFoundException(err(ERRORS.SELLER_NOT_FOUND));
    return this.withUrl(toAdminSellerResponse(seller));
  }

  // Витрина мобилки: только ACTIVE продавцы (SUSPENDED/PENDING не показываем).
  async findOnePublic(id: string, locale: Locale): Promise<SellerResponse> {
    // locale ОБЯЗАН быть в params: ключ кэша считается только по ним (см. И3).
    const seller = await this.cache.wrap('seller', { id, locale }, async () => {
      const found = await this.prisma.seller.findUnique({
        where: { id, status: SellerStatus.ACTIVE },
        include: withTranslations,
      });
      // Промах в БД не кешируется: исключение из колбэка wrap пробрасывает как есть.
      if (!found) throw new NotFoundException(err(ERRORS.SELLER_NOT_FOUND));
      return toSellerResponse(found, locale);
    });
    return this.withUrl(seller);
  }

  // Продавца заводит только SUPER_ADMIN. Владелец — новый User(role: SELLER),
  // логинится в админку по email+паролю, как и остальной staff. sellerId владельцу
  // проставляется вторым шагом: Seller.ownerUserId для него ещё не существует,
  // пока сам продавец не создан, а весь остальной код (groupStaffScope в заказах,
  // видимость категорий/каталога) скоупит SELLER именно по User.sellerId.
  async create(dto: CreateSellerDto): Promise<AdminSellerResponse> {
    const rows = normalizeSellerTranslations(dto.translations);
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
            ownerUserId: owner.id,
            translations: { create: rows },
          },
          include: withTranslations,
        });
        await tx.user.update({
          where: { id: owner.id },
          data: { sellerId: seller.id },
        });
        return seller;
      });
      await this.cache.bump();
      return this.withUrl(toAdminSellerResponse(created));
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

  async update(id: string, dto: UpdateSellerDto): Promise<AdminSellerResponse> {
    // dto.translations не пришёл (частичный PATCH) — переводы не трогаем вообще.
    const rows = dto.translations
      ? normalizeSellerTranslations(dto.translations)
      : null;
    await this.prisma.$transaction([
      this.prisma.seller.update({
        where: { id },
        data: { status: dto.status },
      }),
      ...(rows ?? []).map((r) =>
        this.prisma.sellerTranslation.upsert({
          where: { sellerId_locale: { sellerId: id, locale: r.locale } },
          create: { sellerId: id, ...r },
          update: { name: r.name, description: r.description, auto: r.auto },
        }),
      ),
    ]);
    await this.cache.bump();
    return this.findOne(id);
  }

  async updateBanner(
    id: string,
    bannerKey: string,
  ): Promise<AdminSellerResponse> {
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) {
      throw new NotFoundException(err(ERRORS.SELLER_NOT_FOUND));
    }

    const oldBannerKey = seller.bannerUrl;
    if (oldBannerKey) {
      this.storage.delete(oldBannerKey).catch((e: unknown) => {
        this.logger.warn(`Не удалось удалить старый баннер ${oldBannerKey}`, e);
      });
    }

    await this.prisma.seller.update({
      where: { id },
      data: { bannerUrl: bannerKey },
    });
    await this.cache.bump();
    return this.findOne(id);
  }
}
