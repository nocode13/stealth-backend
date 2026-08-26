import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';

export class EmailSessionDto {
  @ApiProperty({
    example: 'user@gmail.com',
    description: 'Код придёт на этот адрес.',
  })
  @IsEmail({}, { message: 'Некорректный email' })
  email: string;
}

export class EmailVerifyDto {
  @ApiProperty({ example: 'Zk3f…', description: 'nonce из POST email/session' })
  @IsString()
  nonce: string;

  @ApiProperty({ example: '123456', description: 'Код из письма' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'Код состоит из цифр' })
  code: string;
}
