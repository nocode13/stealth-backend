import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpDeliveryRegistry } from './channels/otp-delivery.registry';
import { RequestOtpDto } from './dto/otp.dto';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registry: OtpDeliveryRegistry,
  ) {}

  // Генерирует код, сохраняет его хэш, доставляет через выбранный канал.
  async request(dto: RequestOtpDto): Promise<{ expiresIn: number }> {
    const destination = this.resolveDestination(dto);
    const cooldown = this.config.get<number>('otp.resendCooldownSeconds')!;

    // Resend-cooldown: не выпускаем новый код, пока свежий ещё жив.
    const recent = await this.prisma.otpCode.findFirst({
      where: {
        phone: dto.phone,
        channel: dto.channel,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        createdAt: { gt: new Date(Date.now() - cooldown * 1000) },
      },
    });
    if (recent) {
      throw new BadRequestException(
        `Код уже отправлен. Повторный запрос доступен через ${cooldown} с.`,
      );
    }

    const length = this.config.get<number>('otp.length')!;
    const ttl = this.config.get<number>('otp.ttlSeconds')!;
    const code = this.generateCode(length);

    await this.prisma.otpCode.create({
      data: {
        phone: dto.phone,
        channel: dto.channel,
        destination,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    await this.registry.get(dto.channel).send(destination, code);
    return { expiresIn: ttl };
  }

  // Проверяет код по (phone, channel). Возвращает destination для привязки контакта.
  async verify(
    phone: string,
    channel: OtpChannel,
    code: string,
  ): Promise<{ destination: string }> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        phone,
        channel,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new UnauthorizedException('Код не найден или истёк');
    }

    const maxAttempts = this.config.get<number>('otp.maxAttempts')!;

    if (otp.codeHash !== this.hash(code)) {
      const attempts = otp.attempts + 1;
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: {
          attempts,
          // Превышен лимит попыток — гасим код.
          consumedAt: attempts >= maxAttempts ? new Date() : null,
        },
      });
      throw new UnauthorizedException('Неверный код');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return { destination: otp.destination };
  }

  // Куда доставлять код: sms → сам телефон, email → email, telegram → telegramId.
  private resolveDestination(dto: RequestOtpDto): string {
    switch (dto.channel) {
      case OtpChannel.SMS:
        return dto.phone;
      case OtpChannel.EMAIL:
        return dto.email!;
      case OtpChannel.TELEGRAM:
        return dto.telegramId!;
    }
  }

  private generateCode(length: number): string {
    const max = 10 ** length;
    return randomInt(0, max).toString().padStart(length, '0');
  }

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
