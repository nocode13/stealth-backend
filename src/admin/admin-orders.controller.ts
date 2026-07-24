import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  ChangeOrderStatusDto,
  FindOrdersQueryDto,
  UpdateOrderCourierDto,
} from '../orders/dto/order.dto';
import { OrdersService } from '../orders/orders.service';

// Заказы в админке. SELLER видит и ведёт только свои (скоуп по sellerId внутри
// сервиса), SUPER_ADMIN — все и может фильтровать по продавцу.
@ApiTags('admin/orders')
@ApiCookieAuth()
@Controller('admin/orders')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.SELLER)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'Заказы: фильтр по статусу, поиск по номеру/контакту',
  })
  findAll(@Query() query: FindOrdersQueryDto, @CurrentUser() user: AuthUser) {
    return this.orders.findAllForStaff(user, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.findOneForStaff(user, id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Сменить статус заказа',
    description:
      'Переходы валидируются по ALLOWED_TRANSITIONS — той же карте, по которой ' +
      'строятся кнопки в кабинете продавца в Telegram-боте. Отмена возвращает остаток.',
  })
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.changeStatus(user, id, dto);
  }

  @Patch(':id/courier')
  @ApiOperation({ summary: 'Кто везёт заказ (задел под курьерскую систему)' })
  updateCourier(
    @Param('id') id: string,
    @Body() dto: UpdateOrderCourierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.updateCourier(user, id, dto);
  }
}
