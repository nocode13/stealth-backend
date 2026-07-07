import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LoginDto, RefreshDto, RegisterDto } from '../auth/dto/auth.dto';
import { OtpService } from '../otp/otp.service';
import { RequestOtpDto, VerifyOtpDto } from '../otp/dto/otp.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';

// Аутентификация мобилки: OTP (phone-first) + пароль, access + refresh токены.
@ApiTags('mobile/auth')
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Запросить OTP-код (канал: SMS / EMAIL / TELEGRAM)',
  })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.otp.request(dto);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Проверить OTP-код, вернуть access + refresh токены',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const { destination } = await this.otp.verify(
      dto.phone,
      dto.channel,
      dto.code,
    );
    return this.auth.loginWithOtp(dto.phone, dto.channel, destination);
  }

  @Post('register')
  @ApiOperation({ summary: 'Регистрация по паролю (phone обязателен)' })
  register(@Body() dto: RegisterDto) {
    return this.auth.registerCustomer(dto.phone, dto.password, dto.email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход, возвращает access + refresh токены' })
  async login(@Body() dto: LoginDto) {
    const user = await this.auth.validateCredentials(dto.email, dto.password);
    return this.auth.issueTokens(user.id);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновить пару токенов по refresh-токену (с ротацией)',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refreshTokens(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Текущий пользователь мобилки' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выход, отзывает refresh-токен' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.revokeRefreshToken(dto.refreshToken);
    return { success: true };
  }
}
