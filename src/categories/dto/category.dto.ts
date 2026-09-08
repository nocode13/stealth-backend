import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale, ReviewStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CategoryTranslationDto {
  @ApiProperty({ enum: Locale, example: Locale.RU })
  @IsEnum(Locale)
  locale: Locale;

  @ApiPropertyOptional({
    example: 'Розы',
    description: 'Пусто = не переведено, подставится RU',
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateCategoryDto {
  @ApiProperty({ type: [CategoryTranslationDto], description: 'RU обязателен' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations: CategoryTranslationDto[];
}

// НЕ PartialType(CreateCategoryDto) — @ValidateNested на вложенном массиве ведёт
// себя неочевидно поверх PartialType, поэтому DTO объявлен заново.
export class UpdateCategoryDto {
  @ApiPropertyOptional({ type: [CategoryTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations?: CategoryTranslationDto[];

  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}

export class UpdateCategoryStatusDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;
}

export class FindCategoriesQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию (все локали)' })
  @IsOptional()
  @IsString()
  search?: string;

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
}
