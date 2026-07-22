import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SellerStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateSellerDto {
  @ApiProperty({ example: 'Цветочная лавка' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({ example: 'Свежие цветы с доставкой по городу' })
  @IsOptional()
  @IsString()
  description?: string;

  // Владелец продавца — логин в админку (email+пароль), заводится вместе с продавцом.
  @ApiProperty({ example: 'seller@example.com' })
  @IsEmail()
  ownerEmail: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  ownerPassword: string;

  @ApiPropertyOptional({ example: '+998900000002' })
  @IsOptional()
  @IsString()
  ownerPhone?: string;
}

// Владелец не редактируется через этот DTO — его логин задаётся только при создании.
export class UpdateSellerDto {
  @ApiPropertyOptional({ example: 'Цветочная лавка' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ example: 'Свежие цветы с доставкой по городу' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: SellerStatus })
  @IsOptional()
  @IsEnum(SellerStatus)
  status?: SellerStatus;
}

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
