import { Injectable } from '@nestjs/common';
import type { PlatformSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { UpdatePlatformSettingsDto } from './dto/settings.dto';

const SETTINGS_ID = 'default';

/** Тариф доставки, посчитанный на конкретную сумму товаров. */
export interface DeliveryQuote {
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  freeDeliveryThreshold: number | null;
  /** Сколько ещё добрать до бесплатной доставки; 0 — уже бесплатно/порога нет. */
  amountUntilFreeDelivery: number;
  /** Доставка бесплатна из-за вайтлиста, а не из-за порога — для текста в UI. */
  freeByWhitelist: boolean;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // Синглтон-строка создаётся лениво при первом обращении — миграция уже завела её
  // на проде, но локальные/тестовые БД с накатом миграций до этой правки её не имеют.
  async get(): Promise<PlatformSettings> {
    return this.cache.wrap('settings', {}, async () => {
      const existing = await this.prisma.platformSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (existing) return existing;
      return this.prisma.platformSettings.create({
        data: { id: SETTINGS_ID },
      });
    });
  }

  async update(dto: UpdatePlatformSettingsDto): Promise<PlatformSettings> {
    const updated = await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...dto },
      update: dto,
    });
    await this.cache.bump();
    return updated;
  }

  /**
   * Единственное место в проекте, где считается доставка — корзина и чекаут обязаны
   * звать его, а не повторять формулу.
   */
  async quote(
    itemsTotal: number,
    opts: { allFreeDelivery: boolean },
  ): Promise<DeliveryQuote> {
    const s = await this.get();
    const byThreshold =
      s.freeDeliveryThreshold !== null && itemsTotal >= s.freeDeliveryThreshold;
    const deliveryFee = opts.allFreeDelivery || byThreshold ? 0 : s.deliveryFee;
    const amountUntilFreeDelivery =
      deliveryFee === 0 || s.freeDeliveryThreshold === null
        ? 0
        : Math.max(0, s.freeDeliveryThreshold - itemsTotal);

    return {
      itemsTotal,
      deliveryFee,
      total: itemsTotal + deliveryFee,
      freeDeliveryThreshold: s.freeDeliveryThreshold,
      amountUntilFreeDelivery,
      freeByWhitelist: opts.allFreeDelivery,
    };
  }
}
