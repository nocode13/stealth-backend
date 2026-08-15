import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderGroupStatus, OrderStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

// Тот же E.164, что валидирует мобилка (shared/lib/phone.ts) и PATCH /mobile/auth/me.
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Приводит `status` к массиву, в каком бы виде он ни пришёл в query.
 *
 * Поддерживаем обе формы намеренно: повторяющийся параметр
 * (`?status=NEW&status=CONFIRMED`) — то, что даёт express из коробки, а
 * список через запятую (`?status=NEW,CONFIRMED`) — то, что получается короче и
 * не требует paramsSerializer на клиенте. Одиночное значение (`?status=NEW`)
 * остаётся валидным, поэтому админка и старые клиенты не ломаются.
 */
const toStatusArray = ({ value }: { value: unknown }): unknown => {
  if (value == null) return undefined;

  const raw: unknown[] = Array.isArray(value) ? value : [value];

  return raw
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : item))
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
};

export class CreateOrderDto {
  @ApiProperty({ example: 'Хикматжон' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите имя получателя' })
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(E164, { message: 'Телефон в формате +998901234567' })
  contactPhone!: string;

  // Если задан savedAddressId — сервис подтягивает сохранённый адрес и игнорирует
  // сырые deliveryAddress/deliveryComment/deliveryLat/deliveryLng ниже.
  @ApiPropertyOptional({
    description:
      'ID сохранённого адреса — если задан, deliveryAddress/... игнорируются',
  })
  @IsOptional()
  @IsString()
  savedAddressId?: string;

  @ApiProperty({ example: 'Ташкент, Чиланзар 12-45' })
  @ValidateIf((o: CreateOrderDto) => !o.savedAddressId)
  @IsString()
  @IsNotEmpty({ message: 'Укажите адрес доставки' })
  @MaxLength(500)
  deliveryAddress!: string;

  @ApiPropertyOptional({ example: 'Подъезд 2, этаж 5, домофон 45' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryComment?: string;

  // Координаты приходят из пикера карты (Yandex MapKit/ymaps3) и обязательны для
  // ветки «новый адрес» — так же, как deliveryAddress. Раньше были опциональным
  // бонусом поверх Telegram-локации; теперь это основной способ задать точку.
  @ApiProperty({ example: 41.311081 })
  @ValidateIf((o: CreateOrderDto) => !o.savedAddressId)
  @IsDefined({ message: 'Укажите точку на карте' })
  @Type(() => Number)
  @IsLatitude()
  deliveryLat?: number;

  @ApiProperty({ example: 69.240562 })
  @ValidateIf((o: CreateOrderDto) => !o.savedAddressId)
  @IsDefined({ message: 'Укажите точку на карте' })
  @Type(() => Number)
  @IsLongitude()
  deliveryLng?: number;

  @ApiPropertyOptional({
    description:
      'Сохранить введённый адрес в адресную книгу (игнорируется при savedAddressId)',
  })
  @IsOptional()
  @IsBoolean()
  saveAddress?: boolean;

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

/** Группы чекаута — то, чем листают и ищут и админка, и мобилка. */
export class FindOrderGroupsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: OrderGroupStatus,
    isArray: true,
    description:
      'Фильтр по статусам группы. Несколько значений: ?status=NEW&status=CONFIRMED ' +
      'или ?status=NEW,CONFIRMED. Пусто — все статусы.',
  })
  @IsOptional()
  @Transform(toStatusArray)
  @IsArray()
  @IsEnum(OrderGroupStatus, { each: true })
  status?: OrderGroupStatus[];

  @ApiPropertyOptional({
    description: 'Номер группы, номер заказа, телефон или имя получателя',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Только для SUPER_ADMIN' })
  @IsOptional()
  @IsString()
  sellerId?: string;
}
