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

  @ApiProperty({ example: 25000 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'UZS', default: 'UZS' })
  @IsOptional()
  @IsString()
  currency?: string;

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

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  // Только для SUPER_ADMIN — смотреть листинги конкретного продавца (страница
  // продавца в админке). SELLER всегда скоупится своим sellerId, это поле игнорируется.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerId?: string;
}
