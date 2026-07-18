import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ description: 'ID листинга' })
  @IsString()
  listingId: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;
}
