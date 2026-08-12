import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { ApiBodyOptions } from '@nestjs/swagger';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

// Общие опции для всех загрузок картинок в админке (каталог, баннер продавца).
// storage не указан -> multer использует memoryStorage, на диск не пишем.
// fileFilter — быстрый отсев по клиентскому mimetype ДО чтения тела; настоящая
// проверка формата идёт по содержимому в ImageService.toWebp().
export const imageUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new BadRequestException('Файл должен быть изображением'), false);
      return;
    }
    callback(null, true);
  },
};

// Галерея каталога принимает и фото, и видео одним роутом. Лимит один на роут,
// поэтому он взят по большему (видео); фото дополнительно режется по MAX_IMAGE_SIZE
// уже в хендлере. Настоящая проверка типа — по содержимому: sharp.metadata() для
// фото и ffprobe для видео.
export const mediaUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_VIDEO_SIZE },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) {
      callback(new BadRequestException('Файл должен быть фото или видео'), false);
      return;
    }
    callback(null, true);
  },
};

// Swagger сам по себе поле файла для multipart не показывает — нужна явная схема.
export const imageUploadBody: ApiBodyOptions = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};
