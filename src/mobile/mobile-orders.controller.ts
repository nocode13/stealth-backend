import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BotSessionPurpose } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TelegramLinkService } from '../telegram/telegram-link.service';
import {
  CancelOrderDto,
  CreateOrderDto,
  FindOrdersQueryDto,
} from '../orders/dto/order.dto';
import { OrdersService } from '../orders/orders.service';

// Заказы мобилки: целиком под JWT — гостевых заказов нет, как и гостевой корзины.
@ApiTags('mobile/orders')
@ApiBearerAuth()
@Controller('mobile/orders')
@UseGuards(JwtAuthGuard)
export class MobileOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly links: TelegramLinkService,
  ) {}

  // ── адрес доставки через Telegram ──────────────────────────────────────
  // Тот же приём, что при входе: получаем nonce, открываем бота, поллим ответ.
  // Диплинк обратно в приложение не нужен — возврат ловит именно поллинг,
  // поэтому флоу переживает сворачивание приложения на всех платформах.

  @Post('delivery/location/session')
  @ApiOperation({
    summary: 'Запросить адрес через Telegram-бота',
    description: 'Возвращает ссылку на бота; бот попросит геопозицию кнопкой.',
  })
  createLocationSession(@CurrentUser('id') userId: string) {
    return this.links.createSession(
      userId,
      BotSessionPurpose.DELIVERY_LOCATION,
    );
  }

  @Get('delivery/location/session/:nonce')
  @ApiOperation({
    summary: 'Поллинг адреса',
    description:
      'pending → ждём | received → координаты | expired → начать заново',
  })
  pollLocationSession(
    @CurrentUser('id') userId: string,
    @Param('nonce') nonce: string,
  ) {
    return this.links.pollLocation(nonce, userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Оформить корзину',
    description:
      'Возвращает массив: товары разных продавцов режутся на отдельные заказы ' +
      'с общим groupId. Корзина очищается, остатки списываются.',
  })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateOrderDto) {
    return this.orders.createFromCart(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Мои заказы (курсорная пагинация)' })
  findMine(
    @CurrentUser('id') userId: string,
    @Query() query: FindOrdersQueryDto,
  ) {
    return this.orders.findMine(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Мой заказ целиком: позиции + история статусов' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.orders.findOneMine(userId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Отменить свой заказ (только пока NEW или CONFIRMED)',
  })
  cancel(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancelMine(userId, id, dto);
  }
}
