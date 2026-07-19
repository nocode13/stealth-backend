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
import { TelegramAuthService } from '../telegram/telegram-auth.service';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Аутентификация мобилки: вход только через Telegram, access + refresh токены.
@ApiTags('mobile/auth')
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly telegram: TelegramAuthService,
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
