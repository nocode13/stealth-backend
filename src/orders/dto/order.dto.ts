import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

// Тот же E.164, что валидирует мобилка (shared/lib/phone.ts) и PATCH /mobile/auth/me.
const E164 = /^\+[1-9]\d{6,14}$/;

export class CreateOrderDto {
  @ApiProperty({ example: 'Хикматжон' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите имя получателя' })
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(E164, { message: 'Телефон в формате +998901234567' })
  contactPhone!: string;

  @ApiProperty({ example: 'Ташкент, Чиланзар 12-45' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите адрес доставки' })
  @MaxLength(500)
  deliveryAddress!: string;

  @ApiPropertyOptional({ example: 'Подъезд 2, этаж 5, домофон 45' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryComment?: string;

  // Координаты приходят из Telegram-локации и необязательны: текстового адреса
  // достаточно, чтобы оформить заказ.
  @ApiPropertyOptional({ example: 41.311081 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  deliveryLat?: number;

  @ApiPropertyOptional({ example: 69.240562 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  deliveryLng?: number;

  // paymentMethod намеренно нет: способ оплаты пока один (CASH), сервис ставит его сам.
  // Когда появится Payme/Click — поле добавится опциональным, и старые клиенты не сломаются.
}

export class CancelOrderDto {
  @ApiPropertyOptional({ example: 'Передумал' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ description: 'Комментарий в историю статусов' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class UpdateOrderCourierDto {
  @ApiPropertyOptional({ example: 'Азиз' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;

  @ApiPropertyOptional({ example: '+998901112233' })
  @IsOptional()
  @Matches(E164, { message: 'Телефон в формате +998901234567' })
  courierPhone?: string;
}

export class FindOrdersQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Номер заказа или телефон получателя' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Только для SUPER_ADMIN' })
  @IsOptional()
  @IsString()
  sellerId?: string;
}
