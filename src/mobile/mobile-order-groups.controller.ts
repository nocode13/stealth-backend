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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CancelOrderDto,
  CreateOrderDto,
  FindOrderGroupsQueryDto,
} from '../orders/dto/order.dto';
import { toOrderGroupResponse } from '../orders/order.response';
import { OrdersService } from '../orders/orders.service';
import { StorageService } from '../storage/storage.service';

// Заказ покупателя — это группа: чекаут может резаться на несколько Order по
// продавцам, но для мобилки это одна доставка по одному адресу. Плоских
// /mobile/orders больше нет (см. AGENTS.md «Заказы»).
@ApiTags('mobile/order-groups')
@ApiBearerAuth()
@Controller('mobile/order-groups')
@UseGuards(JwtAuthGuard)
export class MobileOrderGroupsController {
  constructor(
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Оформить корзину',
    description:
      'Товары разных продавцов режутся на отдельные заказы внутри одной группы. ' +
      'Корзина очищается, остатки списываются, доставка платформенная — одна на чекаут.',
  })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateOrderDto) {
    return toOrderGroupResponse(
      await this.orders.createFromCart(userId, dto),
      this.storage,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Мои заказы: группы чекаута (курсорная пагинация)' })
  async findMine(
    @CurrentUser('id') userId: string,
    @Query() query: FindOrderGroupsQueryDto,
  ) {
    const page = await this.orders.findMyGroups(userId, query);
    return {
      ...page,
      items: page.items.map((g) => toOrderGroupResponse(g, this.storage)),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Моя группа целиком: части по продавцам, позиции, история статусов',
  })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return toOrderGroupResponse(
      await this.orders.findOneMyGroup(userId, id),
      this.storage,
    );
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary:
      'Отменить заказ целиком (только пока каждая часть NEW или CONFIRMED)',
  })
  async cancel(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return toOrderGroupResponse(
      await this.orders.cancelMyGroup(userId, id, dto),
      this.storage,
    );
  }
}
