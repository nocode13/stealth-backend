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
import { DEFAULT_LOCALE } from '../i18n/locale';
import {
  ChangeOrderStatusDto,
  FindOrderGroupsQueryDto,
  UpdateOrderCourierDto,
} from '../orders/dto/order.dto';
import {
  OrderGroupResponse,
  toOrderGroupResponse,
  toSellerOrderGroupResponse,
} from '../orders/order.response';
import type { OrderGroupWithOrders } from '../orders/orders.service';
import { OrdersService } from '../orders/orders.service';
import { StorageService } from '../storage/storage.service';

// Заказы в админке — списки и деталка листают ГРУППЫ чекаута (см. AGENTS.md
// «Заказы»): SELLER видит группы, где участвует, но внутри — только свою часть
// и суммы, пересчитанные по видимому. Статус и курьера меняет только SUPER_ADMIN,
// по каждому Order внутри группы отдельно — у SELLER этого пути нет нигде,
// включая Telegram-бота (см. seller.composer.ts).
@ApiTags('admin/orders')
@ApiCookieAuth()
@Controller('admin/orders')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.SELLER)
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Группы заказов: фильтр по статусу, поиск по номеру группы/заказа/контакту',
  })
  async findAll(
    @Query() query: FindOrderGroupsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const page = await this.orders.findGroupsForStaff(user, query);
    return { ...page, items: page.items.map((g) => this.toResponse(user, g)) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Группа заказов целиком: :id — id группы' })
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.toResponse(
      user,
      await this.orders.findOneGroupForStaff(user, id),
    );
  }

  @Patch(':orderId/status')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Сменить статус заказа (только SUPER_ADMIN)',
    description:
      ':orderId — id заказа ВНУТРИ группы. Переходы валидируются по ALLOWED_TRANSITIONS ' +
      '— той же карте, что и в кабинете продавца в Telegram-боте, но кнопок там больше нет. ' +
      'Отмена возвращает остаток. Ответ — вся группа, чтобы деталка заменила состояние целиком.',
  })
  async changeStatus(
    @Param('orderId') orderId: string,
    @Body() dto: ChangeOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return toOrderGroupResponse(
      await this.orders.changeStatus(user, orderId, dto),
      this.storage,
      DEFAULT_LOCALE,
    );
  }

  @Patch(':id/group-status')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Сменить статус ГРУППЫ целиком (только SUPER_ADMIN)',
    description:
      ':id — id группы. Статус каскадом применяется ко всем её нетерминальным ' +
      'заказам через тот же ALLOWED_TRANSITIONS; если хотя бы один заказ не может ' +
      'перейти в целевой статус — отказ 400, ничего не меняется. OrderGroup.status ' +
      'по-прежнему только выводится (deriveGroupStatus), напрямую не пишется.',
  })
  async changeGroupStatus(
    @Param('id') id: string,
    @Body() dto: ChangeOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return toOrderGroupResponse(
      await this.orders.changeGroupStatus(user, id, dto),
      this.storage,
      DEFAULT_LOCALE,
    );
  }

  @Patch(':orderId/courier')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Кто везёт заказ (только SUPER_ADMIN)' })
  async updateCourier(
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderCourierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return toOrderGroupResponse(
      await this.orders.updateCourier(user, orderId, dto),
      this.storage,
      DEFAULT_LOCALE,
    );
  }

  private toResponse(
    user: AuthUser,
    group: OrderGroupWithOrders,
  ): OrderGroupResponse {
    return user.role === Role.SUPER_ADMIN
      ? toOrderGroupResponse(group, this.storage, DEFAULT_LOCALE)
      : toSellerOrderGroupResponse(group, this.storage, DEFAULT_LOCALE);
  }
}
