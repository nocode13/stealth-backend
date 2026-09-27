import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Ступень базовой наценки: от minCost (себестоимость, включительно) до следующей. */
export class MarkupTierDto {
  @ApiProperty({
    description:
      'Нижняя граница себестоимости за единицу, в тийинах, включительно. У первой ступени — 0',
    example: 0,
  })
  @IsInt()
  @Min(0)
  minCost: number;

  @ApiProperty({
    description:
      'Наценка поверх себестоимости, в базисных пунктах (6000 = 60%)',
    example: 6000,
  })
  @IsInt()
  @Min(0)
  @Max(100000)
  markupBps: number;
}

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
    type: [MarkupTierDto],
    description:
      'Ступени базовой наценки по себестоимости — заменяют прежние целиком. Первая с 0, ' +
      'границы по возрастанию. Смена пересчитывает цены всей витрины',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarkupTierDto)
  markupTiers?: MarkupTierDto[];

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
