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
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { RICH_TEXT_MAX_LENGTH, toRichText } from '../../common/rich-text';

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

  @ApiPropertyOptional({
    example: '<p>Свежая <strong>голландская</strong> роза</p>',
    description:
      'HTML из rich-text редактора, теги вне allowlist вырезаются. Пусто = не переведено, подставится RU',
  })
  @IsOptional()
  @Transform(toRichText)
  @IsString()
  @MaxLength(RICH_TEXT_MAX_LENGTH)
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

  @ApiProperty({ description: 'ID категории товаров (верхний уровень)' })
  @IsString()
  categoryId: string;

  @ApiPropertyOptional({
    description: 'ID подкатегории — дочерней для categoryId (необязательна)',
  })
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @ApiPropertyOptional({ description: 'ID страны (необязательна)' })
  @IsOptional()
  @IsString()
  countryId?: string;

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
// subcategoryId/countryId принимают явный null — единственный способ снять уже
// проставленное значение (отсутствие поля означает «не менять»). categoryId снять
// нельзя — категория товаров у позиции обязательна.
export class UpdateCatalogItemDto {
  @ApiPropertyOptional({ type: [CatalogItemTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CatalogItemTranslationDto)
  translations?: CatalogItemTranslationDto[];

  @ApiPropertyOptional({
    description:
      'ID категории товаров. При смене подкатегория, не пришедшая в том же запросе, снимается',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ID подкатегории; null — снять подкатегорию',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  subcategoryId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ID страны; null — снять страну',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  countryId?: string | null;

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

  @ApiPropertyOptional({ description: 'Фильтр по категории товаров' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по подкатегории' })
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по стране' })
  @IsOptional()
  @IsString()
  countryId?: string;

  @ApiPropertyOptional({
    description:
      'true — только позиции без подкатегории (subcategoryId игнорируется)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  noSubcategory?: boolean;

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
