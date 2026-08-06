import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class PollNotificationsDto {
  @ApiPropertyOptional({
    example: 42,
    description:
      'Курсор — seq последнего полученного уведомления. Без него отдаётся ' +
      'бутстрап-страница (последние limit записей), которую клиент показывает ' +
      'как уже прочитанную ленту.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// Формат токена Expo. Проверяем регуляркой ещё на входе, чтобы мусор не оседал
// в push_tokens: PushService такой токен всё равно отбросит перед отправкой.
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[.+\]$/;

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @Matches(EXPO_PUSH_TOKEN, { message: 'Некорректный push-токен Expo' })
  token!: string;

  @ApiProperty({ enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform!: string;
}

export class UnregisterPushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @Matches(EXPO_PUSH_TOKEN, { message: 'Некорректный push-токен Expo' })
  token!: string;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Какие уведомления пометить прочитанными. Пусто — все.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  ids?: string[];
}
