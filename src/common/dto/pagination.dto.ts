import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Базовый query-DTO для cursor-пагинации ("load more"): cursor — id последнего
// элемента предыдущей страницы, limit — размер порции (по умолчанию 20, максимум 100).
export class CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'id последнего элемента предыдущей страницы',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
