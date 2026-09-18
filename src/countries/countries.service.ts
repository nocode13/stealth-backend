import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Locale, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { CacheService } from '../cache/cache.service';
import { normalizeNameTranslations } from '../i18n/translations.util';
import {
  AdminCountryResponse,
  CountryResponse,
  CountryWithTranslations,
  toAdminCountryResponse,
} from './country.response';
import {
  CreateCountryDto,
  FindCountriesQueryDto,
  UpdateCountryDto,
} from './dto/country.dto';

const withTranslations = {
  translations: true,
  _count: { select: { catalogItems: true } },
} satisfies Prisma.CountryInclude;

// Ищем по ЛЮБОЙ локали: админ может искать русское слово, покупатель — узбекское.
function searchFilter(search?: string): Prisma.CountryWhereInput | undefined {
  if (!search) return undefined;
  return {
    translations: { some: { name: { contains: search, mode: 'insensitive' } } },
  };
}

@Injectable()
export class CountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // Платформенный справочник — фильтров по статусу/продавцу нет, видит любой SUPER_ADMIN.
  async findAll(
    query: FindCountriesQueryDto,
  ): Promise<CursorPage<AdminCountryResponse>> {
    const rows = await this.prisma.country.findMany({
      where: searchFilter(query.search),
      include: withTranslations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    const page = toCursorPage(rows, query.limit);
    return { ...page, items: page.items.map(toAdminCountryResponse) };
  }

  // Витрина (мобилка): полный справочник стран, сортированный по имени на нужном языке.
  async findStorefront(
    query: FindCountriesQueryDto,
    locale: Locale,
  ): Promise<CursorPage<CountryResponse>> {
    // locale ОБЯЗАН быть в params: ключ кэша считается только по ним (см. И3).
    return this.cache.wrap('countries', { ...query, locale }, async () => {
      const rows = await this.prisma.countryTranslation.findMany({
        where: { locale, country: { ...searchFilter(query.search) } },
        // Сортировка по имени возможна только отсюда: Prisma не умеет orderBy по to-many.
        orderBy: [{ name: 'asc' }, { countryId: 'asc' }],
        cursor: query.cursor
          ? { countryId_locale: { countryId: query.cursor, locale } }
          : undefined,
        skip: query.cursor ? 1 : 0,
        take: query.limit + 1,
        include: { country: true },
      });
      // Курсор остаётся id СТРАНЫ — контракт CursorPage не меняется.
      const mapped: CountryResponse[] = rows.map((t) => ({
        id: t.countryId,
        code: t.country.code,
        name: t.name,
        createdAt: t.country.createdAt,
        updatedAt: t.country.updatedAt,
      }));
      return toCursorPage(mapped, query.limit);
    });
  }

  async findOne(id: string): Promise<AdminCountryResponse> {
    return toAdminCountryResponse(await this.findRaw(id));
  }

  private async findRaw(id: string): Promise<CountryWithTranslations> {
    const country = await this.prisma.country.findUnique({
      where: { id },
      include: withTranslations,
    });
    // Обычная русская строка, не err(): мобилка страну по id не запрашивает
    // (правило границы из AGENTS.md — переводятся только ошибки, которые видит мобилка).
    if (!country) throw new NotFoundException('Страна не найдена');
    return country;
  }

  // Нужен только чтобы дать понятную 404 при несуществующем id — проверок владения
  // и статуса нет, страна не имеет ни sellerId, ни ReviewStatus.
  async assertUsable(countryId: string): Promise<CountryWithTranslations> {
    return this.findRaw(countryId);
  }

  async create(dto: CreateCountryDto): Promise<AdminCountryResponse> {
    const rows = normalizeNameTranslations(dto.translations);
    try {
      const created = await this.prisma.country.create({
        data: { code: dto.code, translations: { create: rows } },
        include: withTranslations,
      });
      await this.cache.bump();
      return toAdminCountryResponse(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Страна с таким кодом уже есть');
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateCountryDto,
  ): Promise<AdminCountryResponse> {
    await this.findRaw(id);
    // dto.translations не пришёл (частичный PATCH) — переводы не трогаем вообще.
    const rows = dto.translations
      ? normalizeNameTranslations(dto.translations)
      : null;
    if (rows) {
      await this.prisma.$transaction(
        rows.map((r) =>
          this.prisma.countryTranslation.upsert({
            where: { countryId_locale: { countryId: id, locale: r.locale } },
            create: { countryId: id, ...r },
            update: { name: r.name, auto: r.auto },
          }),
        ),
      );
    }
    await this.cache.bump();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findRaw(id);
    const items = await this.prisma.catalogItem.count({
      where: { countryId: id },
    });
    if (items > 0) {
      throw new ConflictException(
        `Нельзя удалить страну: к ней привязано позиций каталога — ${items}. Сначала отвяжите их.`,
      );
    }
    await this.prisma.country.delete({ where: { id } });
    await this.cache.bump();
  }
}
