import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateCatalogItemDto {
  @ApiProperty({ example: 'Красная роза' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({ description: 'ID категории (необязательна)' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'шт', default: 'шт' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({
    description:
      'Позиция из вайтлиста бесплатной доставки. Только SUPER_ADMIN — для остальных игнорируется.',
  })
  @IsOptional()
  @IsBoolean()
  freeDelivery?: boolean;
}

// categoryId вынесен из PartialType и объявлен заново: помимо строки он принимает
// явный null — это единственный способ снять уже проставленную категорию
// (отсутствие поля означает «не менять»).
export class UpdateCatalogItemDto extends PartialType(
  OmitType(CreateCatalogItemDto, ['categoryId'] as const),
) {
  @ApiPropertyOptional({
    nullable: true,
    description: 'ID категории; null — снять категорию',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  categoryId?: string | null;

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
