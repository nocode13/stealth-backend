import { Injectable, Logger } from '@nestjs/common';
import type { AppVersion, Locale } from '@prisma/client';
import { AppPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { UpdateAppVersionDto } from './dto/app-version.dto';
import { compareVersions } from './version-compare';

/** Ответ мобилке: что показать пользователю про обновление из стора. */
export interface AppVersionCheck {
  latestVersion: string | null;
  minSupportedVersion: string | null;
  storeUrl: string | null;
  /** «Что нового» на локали запроса; null — заметок нет. */
  releaseNotes: string | null;
  /** Установка старее latestVersion — мягкая, закрываемая плашка. */
  updateAvailable: boolean;
  /** Установка старее minSupportedVersion — блокирующий экран без «Позже». */
  updateRequired: boolean;
}

/** Пустой ответ: обновлений нет. Единственная форма деградации этого эндпоинта. */
const NO_UPDATE: AppVersionCheck = {
  latestVersion: null,
  minSupportedVersion: null,
  storeUrl: null,
  releaseNotes: null,
  updateAvailable: false,
  updateRequired: false,
};

// Значения для ветки create в upsert. Строки заводит миграция, поэтому сюда попадаем,
// только если строку удалили руками — восстанавливаем безопасный минимум, а не падаем.
const FALLBACK: Record<
  AppPlatform,
  Pick<AppVersion, 'latestVersion' | 'minSupportedVersion' | 'storeUrl'>
> = {
  [AppPlatform.ANDROID]: {
    latestVersion: '1.0.0',
    minSupportedVersion: '1.0.0',
    storeUrl:
      'https://play.google.com/store/apps/details?id=uz.egen.marketplace',
  },
  [AppPlatform.IOS]: {
    latestVersion: '1.0.0',
    minSupportedVersion: '1.0.0',
    storeUrl: 'https://apps.apple.com/app/id0000000000',
  },
};

@Injectable()
export class AppVersionService {
  private readonly logger = new Logger(AppVersionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Строка платформы. Кэшируется, но БЕЗ локали в ключе: тут лежат все три языка
   * заметок сразу, локаль выбирается уже в `check()`. (Ср. с витриной, где в кэш
   * попадает уже резолвнутый текст и `locale` обязана входить в params.)
   */
  async get(platform: AppPlatform): Promise<AppVersion | null> {
    return this.cache.wrap('app-version', { platform }, () =>
      this.prisma.appVersion.findUnique({ where: { platform } }),
    );
  }

  /** Обе строки для формы админки — без кэша, как все админские чтения. */
  async list(): Promise<AppVersion[]> {
    return this.prisma.appVersion.findMany({ orderBy: { platform: 'asc' } });
  }

  async update(
    platform: AppPlatform,
    dto: UpdateAppVersionDto,
  ): Promise<AppVersion> {
    // ⚠️ dropUndefined обязателен: PATCH присылает частичное тело, и ключ со значением
    // undefined всё равно участвует в spread — `{ ...FALLBACK, ...data }` затирал бы
    // им обязательные поля ветки create, и Prisma падала «Argument is missing».
    const data = dropUndefined({
      ...dto,
      // Пустое поле формы = «заметок нет». '' дошло бы до клиента как пустая строка,
      // и плашка нарисовала бы под заголовком пустой абзац.
      releaseNotesRu: emptyToNull(dto.releaseNotesRu),
      releaseNotesUz: emptyToNull(dto.releaseNotesUz),
      releaseNotesEn: emptyToNull(dto.releaseNotesEn),
    });

    const updated = await this.prisma.appVersion.upsert({
      where: { platform },
      create: { platform, ...FALLBACK[platform], ...data },
      update: data,
    });
    await this.cache.bump();
    return updated;
  }

  /**
   * Решение для конкретной установки. Никогда не бросает и не отдаёт 404: этот ответ
   * гейтит вход в приложение, и любая невозможность посчитать вердикт обязана
   * читаться как «обновлений нет», а не как поломка клиента.
   */
  async check(
    platform: AppPlatform,
    version: string | undefined,
    locale: Locale,
  ): Promise<AppVersionCheck> {
    const row = await this.get(platform);
    if (!row || !row.enabled) return NO_UPDATE;

    const base = {
      latestVersion: row.latestVersion,
      minSupportedVersion: row.minSupportedVersion,
      storeUrl: row.storeUrl,
      releaseNotes: pickReleaseNotes(row, locale),
    };

    // Версия не передана — клиент спросил «что сейчас в сторе», сравнивать нечего.
    if (!version)
      return { ...base, updateAvailable: false, updateRequired: false };

    const vsLatest = compareVersions(version, row.latestVersion);
    const vsMin = compareVersions(version, row.minSupportedVersion);
    if (vsLatest === null || vsMin === null) {
      this.logger.warn(
        `Неразбираемая версия при сравнении: установка "${version}", ` +
          `в БД latest "${row.latestVersion}", min "${row.minSupportedVersion}"`,
      );
      return { ...base, updateAvailable: false, updateRequired: false };
    }

    // Защита от опечатки в админке: min > latest заблокировал бы всех разом версией,
    // которой в сторе нет. В таком случае force не включаем — только мягкая плашка.
    const minIsSane =
      (compareVersions(row.minSupportedVersion, row.latestVersion) ?? 1) <= 0;

    return {
      ...base,
      updateAvailable: vsLatest < 0,
      updateRequired: minIsSane && vsMin < 0,
    };
  }
}

/** Убирает ключи со значением undefined — null при этом сохраняется (это «очистить поле»). */
function dropUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function emptyToNull(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() === '' ? null : value;
}

function pickReleaseNotes(row: AppVersion, locale: Locale): string | null {
  const byLocale: Record<Locale, string | null> = {
    RU: row.releaseNotesRu,
    UZ: row.releaseNotesUz,
    EN: row.releaseNotesEn,
  };
  // Фолбэк на русский — тот же инвариант, что у pickTranslation в src/i18n/pick.ts.
  return byLocale[locale] ?? row.releaseNotesRu ?? null;
}
