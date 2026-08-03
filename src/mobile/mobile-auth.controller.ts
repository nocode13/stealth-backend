import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RefreshDto } from '../auth/dto/auth.dto';
import { TelegramMiniAppDto, UpdateProfileDto } from '../auth/dto/telegram.dto';
import { PhoneSessionDto, PhoneVerifyDto } from '../auth/dto/phone.dto';
import { PhoneAuthService } from '../telegram/phone-auth.service';
import { TelegramAuthService } from '../telegram/telegram-auth.service';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Аутентификация мобилки: вход через Telegram или по номеру телефона (код из
// бота), access + refresh токены.
@ApiTags('mobile/auth')
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly telegram: TelegramAuthService,
    private readonly phone: PhoneAuthService,
    private readonly users: UsersService,
  ) {}

  @Post('telegram/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Начать вход через Telegram: nonce + ссылка на бота',
  })
  createTelegramSession() {
    return this.telegram.createSession();
  }

  @Get('telegram/session/:nonce')
  @ApiOperation({
    summary:
      'Статус входа: pending / expired / confirmed (+ токены, отдаются один раз)',
  })
  pollTelegramSession(@Param('nonce') nonce: string) {
    return this.telegram.poll(nonce);
  }

  @Post('phone/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Начать вход по номеру: nonce + ссылка на бота',
    description:
      'Номер подтверждается в боте кнопкой «Поделиться номером», после чего бот ' +
      'присылает код. codeSent=true (и botUrl=null) — шаг с ботом не нужен, ' +
      'сразу вводим код: так устроен тестовый аккаунт для проверки в Play Store.',
  })
  createPhoneSession(@Body() dto: PhoneSessionDto) {
    return this.phone.createSession(dto.phone);
  }

  @Get('phone/session/:nonce')
  @ApiOperation({
    summary: 'Статус входа по номеру: pending / code_sent / mismatch / expired',
  })
  pollPhoneSession(@Param('nonce') nonce: string) {
    return this.phone.poll(nonce);
  }

  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить код из бота и получить токены' })
  verifyPhoneCode(@Body() dto: PhoneVerifyDto) {
    return this.phone.verify(dto.nonce, dto.code);
  }

  @Post('telegram/miniapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вход из Telegram Mini App по подписанной initData',
  })
  miniAppLogin(@Body() dto: TelegramMiniAppDto) {
    return this.telegram.loginWithInitData(dto.initData);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновить пару токенов по refresh-токену (с ротацией)',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refreshTokens(dto.refreshToken);
  }

  // Читаем из БД, а не из claims: профильные поля редактируемые, и в access-токене
  // их намеренно нет — иначе после PATCH /me клиент видел бы старые значения.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Текущий пользователь мобилки' })
  async me(@CurrentUser('id') userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.auth.toAuthUser(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Дозаполнить профиль (имя / телефон / email, все опциональны)',
  })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.users.updateProfile(userId, dto);
    return this.auth.toAuthUser(user);
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
