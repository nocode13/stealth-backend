import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({
    description: 'Стоимость доставки за чекаут, в тийинах',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Сумма товаров, с которой доставка бесплатна; null — бесплатной доставки по порогу нет',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  freeDeliveryThreshold?: number | null;

  @ApiPropertyOptional({
    description:
      'Базовая наценка платформы поверх себестоимости, в базисных пунктах (2000 = 20%)',
    example: 2000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  markupBps?: number;

  @ApiPropertyOptional({
    description:
      'Шаг округления розничной цены вверх, в тийинах (100 = до целого сума)',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  priceRoundingStep?: number;
}
