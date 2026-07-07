import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtpChannel } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

// Телефон в формате E.164 (+998901234567). Обязателен всегда — якорь личности.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export class RequestOtpDto {
  @ApiProperty({ example: '+998901234567', description: 'Телефон (E.164)' })
  @Matches(PHONE_REGEX, {
    message: 'phone должен быть в формате E.164, напр. +998901234567',
  })
  phone: string;

  @ApiProperty({ enum: OtpChannel, description: 'Канал доставки кода' })
  @IsEnum(OtpChannel)
  channel: OtpChannel;

  @ApiPropertyOptional({
    description: 'Email — обязателен только при channel=EMAIL',
    example: 'buyer@example.com',
  })
  @ValidateIf((o: RequestOtpDto) => o.channel === OtpChannel.EMAIL)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Telegram chat id — обязателен только при channel=TELEGRAM',
  })
  @ValidateIf((o: RequestOtpDto) => o.channel === OtpChannel.TELEGRAM)
  @IsString()
  telegramId?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+998901234567' })
  @Matches(PHONE_REGEX, { message: 'phone должен быть в формате E.164' })
  phone: string;

  @ApiProperty({ enum: OtpChannel })
  @IsEnum(OtpChannel)
  channel: OtpChannel;

  @ApiProperty({ example: '123456' })
  @IsString()
  code: string;
}
