import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { IsBusinessDay } from '../../pricing/dto/business-day.validator';

export class PromotionTranslationDto {
  @ApiProperty({ enum: Locale, example: Locale.RU })
  @IsEnum(Locale)
  locale: Locale;

  @ApiPropertyOptional({
    example: 'Осенняя распродажа',
    description: 'Пусто = не переведено, подставится RU',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Скидки на розы до конца недели',
    description: 'Текст в карточке товара, plain text',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class PromotionItemDto {
  @ApiProperty()
  @IsString()
  listingId: string;

  @ApiProperty({
    description:
      'Цена листинга по акции, в тийинах. Не ниже себестоимости; процент скидки ' +
      'считается от обычной розницы',
    example: 9900000,
  })
  @IsInt()
  @Min(1)
  promoPrice: number;
}

export class CreatePromotionDto {
  @ApiProperty({
    type: [PromotionTranslationDto],
    description: 'RU обязателен',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PromotionTranslationDto)
  translations: PromotionTranslationDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-01',
    description: 'Первый день акции (с 00:00 по Ташкенту); null — сразу',
  })
  @IsOptional()
  @IsBusinessDay()
  startDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-07',
    description:
      'Последний день включительно (до 24:00 по Ташкенту); null — бессрочно',
  })
  @IsOptional()
  @IsBusinessDay()
  endDate?: string | null;

  @ApiProperty({ type: [PromotionItemDto], description: 'Листинги в акции' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionItemDto)
  items: PromotionItemDto[];
}

// НЕ PartialType(CreatePromotionDto) — @ValidateNested на вложенных массивах ведёт
// себя неочевидно поверх PartialType (см. UpdateCategoryDto). items, если пришёл,
// заменяет состав акции целиком.
export class UpdatePromotionDto {
  @ApiPropertyOptional({ type: [PromotionTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionTranslationDto)
  translations?: PromotionTranslationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ nullable: true, example: '2026-10-01' })
  @IsOptional()
  @IsBusinessDay()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-10-07' })
  @IsOptional()
  @IsBusinessDay()
  endDate?: string | null;

  @ApiPropertyOptional({ type: [PromotionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionItemDto)
  items?: PromotionItemDto[];
}

export const PROMOTION_STATES = [
  'active',
  'scheduled',
  'ended',
  'disabled',
] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export class FindPromotionsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию (все локали)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: PROMOTION_STATES })
  @IsOptional()
  @IsIn(PROMOTION_STATES)
  state?: PromotionState;
}
