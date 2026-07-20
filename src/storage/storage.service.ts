import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
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
    // S3_PUBLIC_URL уже указывает на конкретный бакет: у R2 это публичный домен
    // бакета, у MinIO — endpoint с именем бакета в пути. Поэтому bucket сюда
    // не подставляем.
    return `${this.publicUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
