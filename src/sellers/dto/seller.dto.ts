import { ApiPropertyOptional } from '@nestjs/swagger';
import { SellerStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class FindSellersQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию продавца' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: SellerStatus })
  @IsOptional()
  @IsEnum(SellerStatus)
  status?: SellerStatus;
}
