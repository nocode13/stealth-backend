import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

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
}
