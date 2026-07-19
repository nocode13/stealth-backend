import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class TelegramMiniAppDto {
  @ApiProperty({
    description:
      'Подписанная строка window.Telegram.WebApp.initData из Mini App',
  })
  @IsString()
  initData: string;
}

// Дозаполнение профиля. Все поля опциональны — обязательными станут на этапе
// заказов. Пустая строка означает «очистить поле».
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Хикматжон' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(/^(\+[1-9]\d{6,14})?$/, {
    message: 'phone должен быть в формате E.164, например +998901234567',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'user@gmail.com' })
  @IsOptional()
  @IsEmail({}, { message: 'email некорректен' })
  email?: string;
}
