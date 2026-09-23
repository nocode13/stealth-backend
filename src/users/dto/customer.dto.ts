import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class FindCustomersQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Подстрока имени, телефона, email или telegramId',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
