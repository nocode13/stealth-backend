import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

// Все ключи кеша витрины лежат под этим префиксом, а версия витрины — в VERSION_KEY.
const NS = 'sf';
const VERSION_KEY = `${NS}:ver`;

// Стабильный JSON: сортируем ключи и выкидываем undefined. Обычный JSON.stringify
// зависит от порядка полей, а он у DTO после ValidationPipe(transform) не гарантирован —
// один и тот же запрос дал бы разные хеши.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private ttlSeconds = 60;
  // Redis отваливается пачкой ошибок на каждый реконнект — логируем не чаще раза в минуту.
  private lastErrorLoggedAt = 0;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('cache.url');
    this.ttlSeconds = this.config.get<number>('cache.ttlSeconds') ?? 60;

    if (!url) {
      this.logger.warn('REDIS_URL не задан — кеш витрины выключен');
      return;
    }

    this.redis = new Redis(url, {
      lazyConnect: true,
      // Без очереди оффлайн-команд: пока соединения нет, команда падает сразу,
      // и wrap() уходит в БД, а не копит запросы в памяти.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      // Приватная сеть Railway (redis.railway.internal) — IPv6-only, а ioredis по
      // умолчанию резолвит в IPv4 и виснет на ETIMEDOUT. family: 0 = «любая версия».
      family: 0,
    });
    this.redis.on('error', (e: Error) => this.logError(e));
    this.redis.connect().catch((e: Error) => this.logError(e));
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  /**
   * Читает из кеша либо считает через fn() и кладёт результат.
   *
   * Любая ошибка на стороне Redis трактуется как промах: кеш не должен быть точкой
   * отказа витрины. Исключения из fn() (например NotFoundException) не кешируются
   * и пробрасываются как есть.
   *
   * ⚠️ Значение проходит через JSON, поэтому Date возвращается ISO-строкой. Для
   * HTTP-ответа это ничего не меняет (там та же сериализация), но такой результат
   * нельзя использовать внутри приложения как настоящую Prisma-сущность.
   */
  async wrap<T>(ns: string, params: unknown, fn: () => Promise<T>): Promise<T> {
    const redis = this.redis;
    if (!redis) return fn();

    let key: string | null = null;
    try {
      const version = (await redis.get(VERSION_KEY)) ?? '0';
      const hash = createHash('sha1')
        .update(stableStringify(params))
        .digest('base64url')
        .slice(0, 16);
      key = `${NS}:${version}:${ns}:${hash}`;
      const cached = await redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
    } catch (e) {
      this.logError(e as Error);
      return fn();
    }

    const value = await fn();
    // Запись не ждём: ответ клиенту не должен зависеть от доступности Redis.
    void redis
      .set(key, JSON.stringify(value), 'EX', this.ttlSeconds)
      .catch((e: Error) => this.logError(e));
    return value;
  }

  /**
   * Инвалидация всей витрины: INCR версии делает все прежние ключи недостижимыми,
   * они умирают сами по TTL. O(1) — без SCAN/DEL по префиксу.
   */
  async bump(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.incr(VERSION_KEY);
    } catch (e) {
      this.logError(e as Error);
    }
  }

  private logError(e: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < 60_000) return;
    this.lastErrorLoggedAt = now;
    this.logger.warn(`Redis недоступен, витрина читается из БД: ${e.message}`);
  }
}
