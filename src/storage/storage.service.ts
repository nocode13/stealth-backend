import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('s3.bucket')!;
    this.publicUrl = this.config.get<string>('s3.publicUrl')!;
    this.client = new S3Client({
      endpoint: this.config.get<string>('s3.endpoint'),
      region: this.config.get<string>('s3.region'),
      forcePathStyle: true, // нужно для MinIO; R2 path-style тоже поддерживает
      credentials: {
        accessKeyId: this.config.get<string>('s3.accessKey')!,
        secretAccessKey: this.config.get<string>('s3.secretKey')!,
      },
    });
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    // В БД хранится только ключ — публичный URL собирается на чтении, см. getUrl().
    return key;
  }

  // Обратная операция к upload(): собирает публичную ссылку из ключа. S3_PUBLIC_URL
  // уже указывает на конкретный бакет: у R2 это публичный домен бакета, у MinIO —
  // endpoint с именем бакета в пути, поэтому bucket сюда не подставляем.
  //
  // Гвард на уже-полный URL — не заглушка на будущее, а защита от гонки при деплое:
  // Redis-кэш переживает редеплой (инвалидация только через CacheService.bump()),
  // и ответ, закэшированный ДО миграции старых ключей, может долежать в кэше и
  // попасть сюда уже с полным URL внутри — без гварда получился бы задвоенный префикс.
  getUrl(key: string): string {
    if (key.startsWith('http://') || key.startsWith('https://')) return key;
    return `${this.publicUrl}/${key}`;
  }

  getUrlOrNull(key: string | null): string | null {
    return key ? this.getUrl(key) : null;
  }

  // Нужна воркеру транскода: оригинал видео лежит в бакете, а не в памяти
  // процесса, поэтому после рестарта недоделанную работу можно подобрать заново.
  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
