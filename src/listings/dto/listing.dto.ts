import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ListingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateListingDto {
  @ApiProperty({ description: 'ID позиции справочника' })
  @IsString()
  catalogItemId: string;

  @ApiProperty({
    description: 'Цена в тиинах (1 сум = 100 тиинов)',
    example: 2500000,
  })
  @IsInt()
  @Min(0)
  price: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiPropertyOptional({ enum: ListingStatus, default: ListingStatus.DRAFT })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}

export class UpdateListingDto extends PartialType(CreateListingDto) {}

export class FindListingsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию позиции справочника' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Фильтр по категории' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  // Только для «моих листингов» (админка) — на витрине статус фиксирован (ACTIVE).
  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @ApiPropertyOptional({ description: 'В тиинах', example: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'В тиинах', example: 10000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  // На витрине мобилки — фильтр листингов конкретного продавца (страница продавца).
  // В админке — только для SUPER_ADMIN (смотреть листинги любого продавца); SELLER
  // всегда скоупится своим sellerId, это поле там игнорируется.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerId?: string;
}
