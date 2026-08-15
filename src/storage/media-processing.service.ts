import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MediaStatus, MediaType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';
import { VideoService } from './video.service';

/**
 * Очередь транскода видео — внутри процесса, без внешнего брокера.
 *
 * Строка `CatalogItemMedia` создаётся сразу со `status: PROCESSING` и ссылкой на
 * загруженный ОРИГИНАЛ, ответ админке уходит немедленно, а mp4 и обложка
 * досоздаются здесь. Оригинал живёт в бакете, а не в памяти, поэтому недоделанную
 * работу можно подобрать после рестарта (`onApplicationBootstrap`) — иначе редеплой
 * посреди транскода оставлял бы вечно висящий PROCESSING.
 *
 * ⚠️ Корректно ровно при `numReplicas: 1` (зафиксировано в railway.json): две реплики
 * подобрали бы одни и те же строки и транскодили их дважды. Тому же ограничению
 * подчинены боты (long-polling/webhook) и гонки на инвентаре.
 */
@Injectable()
export class MediaProcessingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaProcessingService.name);
  // Хвост цепочки промисов = очередь с concurrency 1: транскод жрёт CPU, а реплика
  // одна и на ней же живёт весь API.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
    private readonly video: VideoService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.prisma.catalogItemMedia.findMany({
      where: { type: MediaType.VIDEO, status: MediaStatus.PROCESSING },
      select: { id: true },
    });
    if (stuck.length === 0) return;
    this.logger.log(`Возобновляю обработку ${stuck.length} видео после старта`);
    for (const media of stuck) this.enqueue(media.id);
  }

  /**
   * Ключ для оригинала. Имя случайное, а не по id строки: оригинал заливается
   * ДО создания строки, чтобы не оставлять в БД запись с пустой ссылкой, если
   * заливка сорвётся. Воркер находит оригинал обратно через `media.url`.
   */
  sourceKey(originalName: string): string {
    const ext = extname(originalName).toLowerCase().slice(1) || 'bin';
    return `catalog/video/src/${randomUUID()}.${ext}`;
  }

  enqueue(mediaId: string): void {
    this.queue = this.queue.then(() =>
      this.process(mediaId).catch((error: unknown) => {
        // process() уже пометил строку FAILED; сюда падает только совсем
        // неожиданное — цепочку очереди рвать нельзя, иначе встанут все следующие.
        this.logger.error(`Обработка видео ${mediaId} сорвалась`, error);
      }),
    );
  }

  private async process(mediaId: string): Promise<void> {
    const media = await this.prisma.catalogItemMedia.findUnique({
      where: { id: mediaId },
    });
    // Строку могли удалить, пока задача ждала очереди.
    if (!media || media.status !== MediaStatus.PROCESSING) return;

    const sourceKey = this.storage.keyFromUrl(media.url);
    if (!sourceKey) {
      await this.fail(mediaId, 'ссылка на оригинал не из нашего бакета');
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), 'stealth-media-'));
    const inputPath = join(dir, `src${extname(sourceKey)}`);
    try {
      await writeFile(inputPath, await this.storage.download(sourceKey));

      const probe = await this.video.probe(inputPath);
      const { video, posterPng } = await this.video.transcode(inputPath, probe);
      // Обложка идёт тем же путём, что обычное фото: webp, 1600 по длинной стороне.
      const poster = await this.image.toWebp(posterPng);

      const [url, posterUrl] = await Promise.all([
        this.storage.upload(`catalog/video/${mediaId}.mp4`, video, 'video/mp4'),
        this.storage.upload(
          `catalog/video/${mediaId}-poster.${poster.ext}`,
          poster.buffer,
          poster.contentType,
        ),
      ]);

      // updateMany, а не update: если строку успели удалить, апдейт просто не
      // найдёт её вместо того, чтобы уронить задачу на P2025.
      const { count } = await this.prisma.catalogItemMedia.updateMany({
        where: { id: mediaId, status: MediaStatus.PROCESSING },
        data: { url, posterUrl, status: MediaStatus.READY },
      });
      if (count === 0) {
        await this.cleanup(`catalog/video/${mediaId}.mp4`);
        await this.cleanup(`catalog/video/${mediaId}-poster.${poster.ext}`);
        return;
      }

      // Витрина кэшируется — без bump() позиция ещё несколько минут отдавалась бы
      // без готового видео.
      await this.cache.bump();
      this.logger.log(`Видео ${mediaId} готово`);
    } catch (error: unknown) {
      await this.fail(mediaId, error);
    } finally {
      await rm(dir, { recursive: true, force: true });
      // Оригинал не нужен ни в успехе, ни в ошибке: повторную попытку делают
      // перезагрузкой файла из админки.
      await this.cleanup(sourceKey);
    }
  }

  private async fail(mediaId: string, reason: unknown): Promise<void> {
    this.logger.warn(`Не удалось обработать видео ${mediaId}`, reason);
    await this.prisma.catalogItemMedia.updateMany({
      where: { id: mediaId, status: MediaStatus.PROCESSING },
      data: { status: MediaStatus.FAILED },
    });
    await this.cache.bump();
  }

  private async cleanup(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error: unknown) {
      this.logger.warn(`Не удалось удалить объект ${key}`, error);
    }
  }
}
