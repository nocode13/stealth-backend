import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAddressDto {
  @ApiPropertyOptional({ example: 'Дом' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ example: 'Ташкент, Чиланзар 12-45' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите адрес' })
  @MaxLength(500)
  address!: string;

  @ApiPropertyOptional({ example: 'Подъезд 2, этаж 5, домофон 45' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({ example: 41.311081 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 69.240562 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
