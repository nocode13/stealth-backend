import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { ApiBodyOptions } from '@nestjs/swagger';

// Общие опции для всех загрузок картинок в админке (каталог, баннер продавца).
// storage не указан -> multer использует memoryStorage, на диск не пишем.
// fileFilter — быстрый отсев по клиентскому mimetype ДО чтения тела; настоящая
// проверка формата идёт по содержимому в ImageService.toWebp().
export const imageUploadOptions: MulterOptions = {
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new BadRequestException('Файл должен быть изображением'), false);
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
