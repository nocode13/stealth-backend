import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCatalogItemDto {
  @ApiProperty({ example: 'Красная роза' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'red-rose' })
  @IsString()
  @MinLength(2)
  slug: string;

  @ApiProperty({ example: 'Розы' })
  @IsString()
  category: string;

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

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {}
