import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

// Потолок по длинной стороне. Фото с телефона (4000×3000) ужимается до 1600×1200,
// картинка меньше потолка не трогается вовсе (withoutEnlargement).
const MAX_SIDE = 1600;
const QUALITY = 80;

// Белый список форматов проверяется по РАСПАКОВАННЫМ данным, а не по mimetype из
// multipart: и mimetype, и расширение приходят от клиента. SVG сюда не попадает
// намеренно — бакет читается публично, а SVG исполняет скрипты в браузере.
const ALLOWED_FORMATS = new Set([
  'jpeg',
  'png',
  'webp',
  'avif',
  'heif',
  'gif',
  'tiff',
]);

export interface ProcessedImage {
  buffer: Buffer;
  contentType: 'image/webp';
  ext: 'webp';
}

@Injectable()
export class ImageService {
  // Перекодирует загруженный файл в WebP. Кропа и апскейла нет: fit 'inside'
  // вписывает в квадрат MAX_SIDE, сохраняя пропорции.
  async toWebp(input: Buffer): Promise<ProcessedImage> {
    const pipeline = sharp(input, { failOn: 'error' });

    let format: string | undefined;
    try {
      ({ format } = await pipeline.metadata());
    } catch {
      throw new BadRequestException('Не удалось прочитать изображение');
    }
    if (!format || !ALLOWED_FORMATS.has(format)) {
      throw new BadRequestException('Неподдерживаемый формат изображения');
    }

    const buffer = await pipeline
      // EXIF-ориентацию нужно применить ДО того, как метаданные будут отброшены,
      // иначе фото с телефона ляжет боком.
      .rotate()
      .resize({
        width: MAX_SIDE,
        height: MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // keepMetadata не зовём: EXIF (в т.ч. GPS оригинального снимка) не переносится.
      .webp({ quality: QUALITY })
      .toBuffer();

    return { buffer, contentType: 'image/webp', ext: 'webp' };
  }
}
