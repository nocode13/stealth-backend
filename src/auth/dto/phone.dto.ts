import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class PhoneSessionDto {
  @ApiProperty({
    example: '+998901234567',
    description:
      'Номер в E.164. Подтверждается в боте кнопкой «Поделиться номером».',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'Некорректный номер телефона' })
  phone: string;
}

export class PhoneVerifyDto {
  @ApiProperty({ example: 'Zk3f…', description: 'nonce из POST phone/session' })
  @IsString()
  nonce: string;

  @ApiProperty({ example: '123456', description: 'Код из чата с ботом' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'Код состоит из цифр' })
  code: string;
}
