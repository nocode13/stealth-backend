import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale, SellerStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { RICH_TEXT_MAX_LENGTH, toRichText } from '../../common/rich-text';

export class SellerTranslationDto {
  @ApiProperty({ enum: Locale, example: Locale.RU })
  @IsEnum(Locale)
  locale: Locale;

  @ApiPropertyOptional({
    example: 'Цветочная лавка',
    description: 'Пусто = не переведено, подставится RU',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: '<p>Свежие цветы с <strong>доставкой</strong> по городу</p>',
    description:
      'HTML из rich-text редактора, теги вне allowlist вырезаются. Пусто = не переведено, подставится RU',
  })
  @IsOptional()
  @Transform(toRichText)
  @IsString()
  @MaxLength(RICH_TEXT_MAX_LENGTH)
  description?: string;
}

export class CreateSellerDto {
  @ApiProperty({ type: [SellerTranslationDto], description: 'RU обязателен' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SellerTranslationDto)
  translations: SellerTranslationDto[];

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
  @ApiPropertyOptional({ type: [SellerTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SellerTranslationDto)
  translations?: SellerTranslationDto[];

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
