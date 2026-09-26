import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PriceRuleAction } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { IsBusinessDay } from './business-day.validator';

// null в nullable-поле = «снять ограничение» (область/даты/остаток), в PATCH
// undefined = не трогать. Проверки, завязанные на несколько полей (value по action,
// start ≤ end, min ≤ max), — в PriceRulesService.validate: они смотрят на итог
// слияния со строкой из БД.
export class CreatePriceRuleDto {
  @ApiProperty({ example: 'Наценка на розы 30%' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    description:
      'Из подходящих правил применяется одно — с наибольшим priority',
    example: 10,
  })
  @IsInt()
  priority: number;

  @ApiProperty({ enum: PriceRuleAction })
  @IsEnum(PriceRuleAction)
  action: PriceRuleAction;

  @ApiProperty({
    description:
      'bps для MARKUP_PERCENT/DISCOUNT_PERCENT (1000 = 10%), тийины для FIXED_PRICE',
    example: 3000,
  })
  @IsInt()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ nullable: true, description: 'Область: продавец' })
  @IsOptional()
  @IsString()
  sellerId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Область: категория' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Область: позиция каталога',
  })
  @IsOptional()
  @IsString()
  catalogItemId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Область: листинг' })
  @IsOptional()
  @IsString()
  listingId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-01',
    description: 'Первый день действия (с 00:00 по Ташкенту)',
  })
  @IsOptional()
  @IsBusinessDay()
  startDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-07',
    description: 'Последний день действия включительно (до 24:00 по Ташкенту)',
  })
  @IsOptional()
  @IsBusinessDay()
  endDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  minStock?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxStock?: number | null;
}

export class UpdatePriceRuleDto extends PartialType(CreatePriceRuleDto) {}

export class FindPriceRulesQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию' })
  @IsOptional()
  @IsString()
  search?: string;
}
