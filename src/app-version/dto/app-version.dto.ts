import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppPlatform } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Формат версии приложения: "1", "1.0", "1.0.21", "1.0.21.4". */
const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

export class CheckAppVersionQueryDto {
  @ApiProperty({ enum: AppPlatform, description: 'Платформа установки' })
  @IsEnum(AppPlatform)
  platform!: AppPlatform;

  @ApiPropertyOptional({
    example: '1.0.21',
    description:
      'Установленная версия. Без неё сравнение не делается и оба флага приходят false',
  })
  @IsOptional()
  @IsString()
  @Matches(VERSION_PATTERN, { message: 'version: ожидается формат 1.0.21' })
  version?: string;
}

export class UpdateAppVersionDto {
  @ApiPropertyOptional({
    example: '1.0.22',
    description: 'Актуальная версия в сторе',
  })
  @IsOptional()
  @IsString()
  @Matches(VERSION_PATTERN, {
    message: 'latestVersion: ожидается формат 1.0.21',
  })
  latestVersion?: string;

  @ApiPropertyOptional({
    example: '1.0.10',
    description:
      'Минимально поддерживаемая версия; установки ниже получают блокирующий экран',
  })
  @IsOptional()
  @IsString()
  @Matches(VERSION_PATTERN, {
    message: 'minSupportedVersion: ожидается формат 1.0.21',
  })
  minSupportedVersion?: string;

  @ApiPropertyOptional({ description: 'Ссылка на карточку в сторе' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  storeUrl?: string;

  // Пустая строка из формы админки = «заметок нет»: сервис сам приводит её к null,
  // поэтому @IsString() тут допускает '' и отдельного ValidateIf на null достаточно.
  @ApiPropertyOptional({ nullable: true, description: '«Что нового», русский' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  releaseNotesRu?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '«Что нового», узбекский',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  releaseNotesUz?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '«Что нового», английский',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  releaseNotesEn?: string | null;

  @ApiPropertyOptional({
    description: 'false — плашки для платформы полностью выключены',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
