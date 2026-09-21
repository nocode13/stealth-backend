import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BroadcastAudience } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export const BROADCAST_TITLE_MAX = 100;
// Лимит — по plain text (проверяет сервис): у Telegram 4096 символов на сообщение,
// часть занимает заголовок. Сам HTML с тегами длиннее, отсюда запас ниже.
export const BROADCAST_BODY_TEXT_MAX = 3500;
const BROADCAST_BODY_HTML_MAX = 20_000;
const BUTTON_TEXT_MAX = 40;
const SELECTED_MAX = 1000;

// Тексты одного поля на всех языках. RU обязателен — он фолбэк для UZ/EN
// (pickText), пустые UZ/EN сервис просто не сохраняет.
export class BroadcastTitleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BROADCAST_TITLE_MAX)
  RU!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BROADCAST_TITLE_MAX)
  UZ?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BROADCAST_TITLE_MAX)
  EN?: string;
}

export class BroadcastBodyDto {
  @ApiProperty({ description: 'HTML из rich-text редактора' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BROADCAST_BODY_HTML_MAX)
  RU!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BROADCAST_BODY_HTML_MAX)
  UZ?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BROADCAST_BODY_HTML_MAX)
  EN?: string;
}

export class BroadcastButtonTextDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUTTON_TEXT_MAX)
  RU!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BUTTON_TEXT_MAX)
  UZ?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BUTTON_TEXT_MAX)
  EN?: string;
}

/** Кому шлём — общая часть создания и предварительного подсчёта. */
export class BroadcastAudienceDto {
  @ApiProperty({ enum: BroadcastAudience })
  @IsEnum(BroadcastAudience)
  audience!: BroadcastAudience;

  @ApiPropertyOptional({
    type: [String],
    description: 'id покупателей, обязателен при audience = SELECTED',
  })
  @ValidateIf((o: BroadcastAudienceDto) => o.audience === BroadcastAudience.SELECTED)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SELECTED_MAX)
  @IsString({ each: true })
  recipientIds?: string[];
}

export class CreateBroadcastDto extends BroadcastAudienceDto {
  @ApiProperty({ type: BroadcastTitleDto })
  @ValidateNested()
  @Type(() => BroadcastTitleDto)
  title!: BroadcastTitleDto;

  @ApiProperty({ type: BroadcastBodyDto })
  @ValidateNested()
  @Type(() => BroadcastBodyDto)
  body!: BroadcastBodyDto;

  @ApiProperty()
  @IsBoolean()
  sendPush!: boolean;

  @ApiProperty()
  @IsBoolean()
  sendTelegram!: boolean;

  // Кнопка — только для Telegram, и только целиком: текст без ссылки (и наоборот)
  // не имеет смысла.
  @ApiPropertyOptional({ type: BroadcastButtonTextDto })
  @ValidateIf((o: CreateBroadcastDto) => o.buttonUrl != null)
  @ValidateNested()
  @Type(() => BroadcastButtonTextDto)
  buttonText?: BroadcastButtonTextDto;

  @ApiPropertyOptional({ example: 'https://t.me/egen_bot/app' })
  @ValidateIf((o: CreateBroadcastDto) => o.buttonText != null)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  buttonUrl?: string;
}

export class FindBroadcastsQueryDto extends CursorPaginationDto {}
