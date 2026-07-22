import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateCatalogItemDto {
  @ApiProperty({ example: 'Красная роза' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'red-rose' })
  @IsString()
  @MinLength(2)
  slug: string;

  @ApiProperty({ description: 'ID категории' })
  @IsString()
  categoryId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'шт', default: 'шт' })
  @IsOptional()
  @IsString()
  unit?: string;
}

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {
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
