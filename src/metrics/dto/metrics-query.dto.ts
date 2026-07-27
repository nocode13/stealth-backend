import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class MetricsPeriodQueryDto {
  @ApiPropertyOptional({
    description:
      'Начало периода (включительно). Не задано — без нижней границы.',
    example: '2026-07-01',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    description:
      'Конец периода (включительно). Не задано — без верхней границы.',
    example: '2026-07-27',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
