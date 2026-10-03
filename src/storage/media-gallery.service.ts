import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CatalogItemMedia, MediaStatus, MediaType } from '@prisma/client';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';
import { MediaProcessingService } from './media-processing.service';

const MAX_MEDIA_PER_GALLERY = 10;

/**
 * Чья галерея. Строки лежат в одной таблице (catalog_item_media), владелец ровно
 * один — CHECK в БД. Объект подставляется в where как есть.
 */
export type MediaOwner = { catalogItemId: string } | { listingId: string };

/**
 * Галерея фото/видео — общая для позиции каталога и листинга (варианта). Владение
 * проверяет вызывающий доменный сервис ДО вызова: здесь только сама галерея
 * (лимит, порядок, S3, bump кэша витрины).
 */
@Injectable()
export class MediaGalleryService {
  private readonly logger = new Logger(MediaGalleryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
    private readonly mediaProcessing: MediaProcessingService,
  ) {}

  /** Вся галерея, включая PROCESSING/FAILED (админка), ключами S3. */
  list(owner: MediaOwner): Promise<CatalogItemMedia[]> {
    return this.prisma.catalogItemMedia.findMany({
      where: owner,
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Фото конвертируется в webp и готово сразу. Видео заливается оригиналом, строка
   * создаётся в PROCESSING, mp4 и обложку дорисует MediaProcessingService.
   * Файл уже проверен на поверхности (assertMediaFile в admin/upload.options.ts).
   */
  async add(owner: MediaOwner, file: Express.Multer.File): Promise<void> {
    // Лимит — до заливки, чтобы не оставлять в бакете объект без строки.
    const count = await this.prisma.catalogItemMedia.count({ where: owner });
    if (count >= MAX_MEDIA_PER_GALLERY) {
      throw new ForbiddenException(
        `Не больше ${MAX_MEDIA_PER_GALLERY} медиафайлов в галерее`,
      );
    }
    const last = await this.prisma.catalogItemMedia.findFirst({
      where: owner,
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = last ? last.sortOrder + 1 : 0;

    if (file.mimetype.startsWith('video/')) {
      const key = this.mediaProcessing.sourceKey(file.originalname);
      await this.storage.upload(key, file.buffer, file.mimetype);
      let mediaId: string;
      try {
        const created = await this.prisma.catalogItemMedia.create({
          data: {
            ...owner,
            url: key,
            type: MediaType.VIDEO,
            status: MediaStatus.PROCESSING,
            sortOrder,
          },
        });
        mediaId = created.id;
      } catch (error) {
        // Владелец успел исчезнуть — оригинал в бакете не нужен.
        await this.storage.delete(key).catch(() => undefined);
        throw error;
      }
      this.mediaProcessing.enqueue(mediaId);
    } else {
      // Расширение и Content-Type берём из результата конвертации, а не из
      // originalname/mimetype — те приходят от клиента и ничем не подтверждены.
      const { buffer, contentType, ext } = await this.image.toWebp(file.buffer);
      const key = `catalog/${ownerKeyPart(owner)}-${Date.now()}.${ext}`;
      await this.storage.upload(key, buffer, contentType);
      await this.prisma.catalogItemMedia.create({
        data: {
          ...owner,
          url: key,
          type: MediaType.IMAGE,
          status: MediaStatus.READY,
          sortOrder,
        },
      });
    }
    await this.cache.bump();
  }

  async remove(owner: MediaOwner, mediaId: string): Promise<void> {
    const media = await this.prisma.catalogItemMedia.findFirst({
      where: { id: mediaId, ...owner },
    });
    if (!media) throw new NotFoundException('Медиафайл не найден');

    // У видео объектов в бакете два: сам файл и обложка (у PROCESSING в url лежит
    // ещё не обработанный оригинал — его тоже надо убрать).
    for (const key of [media.url, media.posterUrl]) {
      if (!key) continue;
      this.storage.delete(key).catch((e: unknown) => {
        this.logger.warn(`Не удалось удалить объект ${key}`, e);
      });
    }

    await this.prisma.catalogItemMedia.delete({ where: { id: mediaId } });
    await this.cache.bump();
  }

  /** Обмен sortOrder с соседом. У края галереи — no-op. */
  async reorder(
    owner: MediaOwner,
    mediaId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const media = await this.list(owner);
    const index = media.findIndex((m) => m.id === mediaId);
    if (index === -1) throw new NotFoundException('Медиафайл не найден');

    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= media.length) return;

    const a = media[index];
    const b = media[swapWith];
    await this.prisma.$transaction([
      this.prisma.catalogItemMedia.update({
        where: { id: a.id },
        data: { sortOrder: b.sortOrder },
      }),
      this.prisma.catalogItemMedia.update({
        where: { id: b.id },
        data: { sortOrder: a.sortOrder },
      }),
    ]);
    await this.cache.bump();
  }
}

const ownerKeyPart = (owner: MediaOwner): string =>
  'catalogItemId' in owner ? owner.catalogItemId : `listing-${owner.listingId}`;
