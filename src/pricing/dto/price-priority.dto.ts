import { ApiProperty } from '@nestjs/swagger';
import { PriceSource } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';

export class UpdatePricePrioritiesDto {
  @ApiProperty({
    enum: PriceSource,
    isArray: true,
    description:
      'Все источники цены ровно по разу, сверху вниз; BASE_MARKUP — последним',
    example: ['PROMOTION', 'LISTING_MARKUP', 'BASE_MARKUP'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(PriceSource, { each: true })
  order: PriceSource[];
}
