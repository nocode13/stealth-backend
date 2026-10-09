import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale, ReviewStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
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

// Ключ категории товаров для фронта: латиница в нижнем регистре, цифры, «_» и «-».
export const CATEGORY_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,49}$/;

export class CreateCategoryDto {
  @ApiProperty({ type: [CategoryTranslationDto], description: 'RU обязателен' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations: CategoryTranslationDto[];

  @ApiPropertyOptional({
    description:
      'Родитель — категория верхнего уровня. Пусто = категория товаров (только SUPER_ADMIN)',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    example: 'houseplants',
    description:
      'Стабильный ключ для фронта. Обязателен у категории верхнего уровня, у подкатегории запрещён',
  })
  @IsOptional()
  @Matches(CATEGORY_CODE_PATTERN)
  code?: string;

  @ApiPropertyOptional({ description: 'Порядок плиток (только SUPER_ADMIN)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  position?: number;
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

  // parentId после создания не меняется: позиции каталога держат пару
  // categoryId/subcategoryId, перенос подкатегории рассинхронизировал бы их.
  @ApiPropertyOptional({
    example: 'houseplants',
    description: 'Только SUPER_ADMIN и только у категории верхнего уровня',
  })
  @IsOptional()
  @Matches(CATEGORY_CODE_PATTERN)
  code?: string;

  @ApiPropertyOptional({ description: 'Порядок плиток (только SUPER_ADMIN)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  position?: number;
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

  @ApiPropertyOptional({ description: 'Только подкатегории этой категории' })
  @IsOptional()
  @IsString()
  parentId?: string;

  // Мобилке не нужен: без parentId витрина и так отдаёт только верхний уровень.
  @ApiPropertyOptional({
    description: 'true — только категории верхнего уровня (админка)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  root?: boolean;

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
