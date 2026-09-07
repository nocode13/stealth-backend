import {
  Body,
  Controller,
  Delete,
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
import { Locale } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RefreshDto } from '../auth/dto/auth.dto';
import { EmailSessionDto, EmailVerifyDto } from '../auth/dto/email.dto';
import { EmailAuthService } from '../auth/email-auth.service';
import { TelegramMiniAppDto, UpdateProfileDto } from '../auth/dto/telegram.dto';
import { TelegramAuthService } from '../telegram/telegram-auth.service';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Аутентификация мобилки: вход через Telegram или по коду на почту (Resend),
// access + refresh токены.
@ApiTags('mobile/auth')
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly telegram: TelegramAuthService,
    private readonly email: EmailAuthService,
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

  @Post('email/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Начать вход по почте: код уходит на адрес сразу',
    description:
      'Поллинга нет: код приходит на почту сразу при создании сессии. ' +
      '400 — вход по почте не сконфигурирован (пуст RESEND_API_KEY).',
  })
  createEmailSession(@Body() dto: EmailSessionDto) {
    return this.email.createSession(dto.email);
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить код из письма и получить токены' })
  verifyEmailCode(@Body() dto: EmailVerifyDto) {
    return this.email.verify(dto.nonce, dto.code);
  }

  @Post('email/link/session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Привязать/сменить почту текущего аккаунта: код на новый адрес',
    description:
      '409 сразу, если адрес занят другим аккаунтом — не дожидаясь письма.',
  })
  createEmailLinkSession(
    @CurrentUser('id') userId: string,
    @Body() dto: EmailSessionDto,
  ) {
    return this.email.createLinkSession(userId, dto.email);
  }

  @Post('email/link/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Подтвердить код и привязать почту к текущему аккаунту',
  })
  async verifyEmailLink(
    @CurrentUser('id') userId: string,
    @Body() dto: EmailVerifyDto,
  ) {
    const user = await this.email.verifyLink(userId, dto.nonce, dto.code);
    return this.auth.toAuthUser(user);
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
  @ApiOperation({
    summary: 'Текущий пользователь мобилки',
    description:
      'isTest=true — тестовый аккаунт для проверки в Play Store: профиль у него ' +
      'read-only, PATCH /mobile/auth/me вернёт 403.',
  })
  async me(@CurrentUser('id') userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.auth.toAuthUser(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Дозаполнить профиль (имя / телефон, оба опциональны)',
    description:
      'Email в теле не принимается (email — якорь входа, меняется только через ' +
      'код на почту): forbidNonWhitelisted отвергнет такое тело. Занятый phone → ' +
      '409. Тестовому аккаунту (isTest в GET /me) правка профиля запрещена целиком → 403.',
  })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.users.updateProfile(userId, dto);
    return this.auth.toAuthUser(user);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить аккаунт',
    description:
      'Профиль, адреса, корзина, уведомления, push-токены и сессии удаляются; ' +
      'заказы остаются обезличенными (отчётность продавца). Активные заказы ' +
      'блокируют удаление → 409. Тестовому аккаунту Play Store → 403.',
  })
  async deleteMe(@CurrentUser('id') userId: string) {
    await this.users.deleteAccount(userId);
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

  @Post('locale')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Запомнить язык для пушей и Telegram-сообщений',
    description:
      'Тела нет: язык берётся из того же Accept-Language, что и у остальных запросов — ' +
      'так между заголовком и сохранённым значением не может быть рассинхрона. ' +
      'Пуши уходят вне HTTP-запроса, поэтому язык нужен в БД.',
  })
  async setLocale(
    @CurrentUser('id') userId: string,
    @ReqLocale() locale: Locale,
  ) {
    await this.users.setLocale(userId, locale);
  }
}
