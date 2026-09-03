import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale, ReviewStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CatalogItemTranslationDto {
  @ApiProperty({ enum: Locale, example: Locale.RU })
  @IsEnum(Locale)
  locale: Locale;

  @ApiPropertyOptional({
    example: 'Красная роза',
    description: 'Пусто = не переведено, подставится RU',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'шт' })
  @IsOptional()
  @IsString()
  unit?: string;
}

export class CreateCatalogItemDto {
  @ApiProperty({
    type: [CatalogItemTranslationDto],
    description: 'RU обязателен',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CatalogItemTranslationDto)
  translations: CatalogItemTranslationDto[];

  @ApiPropertyOptional({ description: 'ID категории (необязательна)' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Позиция из вайтлиста бесплатной доставки. Только SUPER_ADMIN — для остальных игнорируется.',
  })
  @IsOptional()
  @IsBoolean()
  freeDelivery?: boolean;
}

// Не PartialType/OmitType от CreateCatalogItemDto: @ValidateNested на вложенном
// массиве переводов ведёт себя неочевидно поверх PartialType (см. category.dto.ts).
// categoryId принимает явный null — единственный способ снять уже проставленную
// категорию (отсутствие поля означает «не менять»).
export class UpdateCatalogItemDto {
  @ApiPropertyOptional({ type: [CatalogItemTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CatalogItemTranslationDto)
  translations?: CatalogItemTranslationDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'ID категории; null — снять категорию',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({
    description:
      'Позиция из вайтлиста бесплатной доставки. Только SUPER_ADMIN — для остальных игнорируется.',
  })
  @IsOptional()
  @IsBoolean()
  freeDelivery?: boolean;

  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}

export class FindCatalogQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Фильтр по категории' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'true — только позиции без категории (categoryId игнорируется)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  noCategory?: boolean;

  // Только для SUPER_ADMIN — для SELLER игнорируется (видимость считается отдельно).
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  // Только для SUPER_ADMIN — для SELLER игнорируется.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerId?: string;

  @ApiPropertyOptional({
    description: 'Только позиции из вайтлиста бесплатной доставки',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  freeDelivery?: boolean;
}

export class ReorderCatalogMediaDto {
  @ApiProperty({ enum: ['up', 'down'] })
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}
