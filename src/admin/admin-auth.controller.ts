import {
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LocalAuthGuard } from '../auth/guards/local-auth.guard';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { LoginDto } from '../auth/dto/auth.dto';
import { BotSessionPurpose } from '@prisma/client';
import { TelegramLinkService } from '../telegram/telegram-link.service';

@ApiTags('admin/auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly links: TelegramLinkService) {}

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход в админку (session httpOnly cookie)' })
  @ApiBody({ type: LoginDto })
  login(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('logout')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выход из админки (уничтожает сессию)' })
  logout(@Req() req: Request): Promise<{ success: boolean }> {
    return new Promise((resolve, reject) => {
      req.logout((err) => {
        if (err)
          return reject(err instanceof Error ? err : new Error(String(err)));
        req.session.destroy(() => resolve({ success: true }));
      });
    });
  }

  @Get('me')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Текущий пользователь админки' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('telegram/link')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ссылка для привязки Telegram к аккаунту',
    description:
      'Продавец переходит по botUrl и жмёт Start — после этого заказы приходят ' +
      'ему в бота и он может менять их статус прямо в чате.',
  })
  linkTelegram(@CurrentUser() user: AuthUser) {
    return this.links.createSession(user.id, BotSessionPurpose.SELLER_LINK);
  }

  @Post('telegram/unlink')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отвязать Telegram от аккаунта',
    description:
      'Освобождает telegramId — заказы перестают приходить в бота. ' +
      'Привязать заново можно в любой момент через /telegram/link.',
  })
  async unlinkTelegram(@CurrentUser() user: AuthUser): Promise<AuthUser> {
    await this.links.unlinkSeller(user.id);
    return { ...user, telegramId: null };
  }
}
