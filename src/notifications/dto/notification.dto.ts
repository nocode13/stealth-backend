import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
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
