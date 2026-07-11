import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Розы' })
  @IsString()
  @MinLength(2)
  nameRu: string;

  @ApiPropertyOptional({ example: 'Atirgullar' })
  @IsOptional()
  @IsString()
  nameUz?: string;

  @ApiPropertyOptional({ example: 'Roses' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ example: 'Atirgúller' })
  @IsOptional()
  @IsString()
  nameKaa?: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}

export class UpdateCategoryStatusDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;
}

export class FindCategoriesQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Поиск по названию (все локали)' })
  @IsOptional()
  @IsString()
  search?: string;

  // Только для SUPER_ADMIN — для SELLER игнорируется (видимость считается отдельно).
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  // Только для SUPER_ADMIN — для SELLER игнорируется.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerId?: string;
}
