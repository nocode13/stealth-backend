import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Сотрудник продавца. Все контакты опциональны: минимальный сценарий — завести
 * человека с одним именем и выдать ему инвайт-ссылку в бота. Пароль нужен только
 * тем, кто будет ходить в админку.
 */
export class CreateSellerStaffDto {
  @ApiPropertyOptional({ example: 'Азиз' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+998900000003' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'staff@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'password123',
    description:
      'Без пароля вход в админку недоступен, кабинет в боте работает',
  })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}

// Роль и продавец через API не меняются: сотрудник заводится в команду и живёт в ней.
export class UpdateSellerStaffDto extends CreateSellerStaffDto {}

export class SellerStaffDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty({ nullable: true }) email: string | null;
  @ApiProperty({ description: 'Привязан ли рабочий Telegram (бот продавца)' })
  telegramLinked: boolean;
  @ApiProperty({ description: 'Владелец продавца — не удаляется' })
  isOwner: boolean;
  @ApiProperty({ description: 'Может ли войти в админку (задан пароль)' })
  hasPassword: boolean;
  @ApiProperty() createdAt: Date;
}
