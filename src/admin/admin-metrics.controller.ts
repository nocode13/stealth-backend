import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { MetricsPeriodQueryDto } from '../metrics/dto/metrics-query.dto';
import { MetricsService } from '../metrics/metrics.service';

// Метрики платформы для дашборда админки. Только SUPER_ADMIN — цифры не scoped
// по продавцу, в отличие от /admin/orders.
@ApiTags('admin/metrics')
@ApiCookieAuth()
@Controller('admin/metrics')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('users')
  @ApiOperation({
    summary: 'Новые пользователи за период + всего пользователей',
  })
  getUsers(@Query() query: MetricsPeriodQueryDto) {
    return this.metrics.getUsers(query);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Заказы и выручка за период, разбивка по статусам' })
  getOrders(@Query() query: MetricsPeriodQueryDto) {
    return this.metrics.getOrders(query);
  }

  @Get('catalog')
  @ApiOperation({
    summary: 'Снимок продавцов/каталога: активные, ожидающие апрува',
  })
  getCatalog() {
    return this.metrics.getCatalog();
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Сводка для верхней части дашборда: сегодня + всё время',
  })
  getOverview() {
    return this.metrics.getOverview();
  }
}
