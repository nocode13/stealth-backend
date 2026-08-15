import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ReviewStatus,
  SellerStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsPeriodQueryDto } from './dto/metrics-query.dto';

export interface UsersMetrics {
  newInPeriod: number;
  totalUsers: number;
}

export interface OrdersMetricsByStatus {
  status: OrderStatus;
  count: number;
  total: number;
}

export interface OrdersMetrics {
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  byStatus: OrdersMetricsByStatus[];
}

export interface CatalogMetrics {
  activeSellers: number;
  listingCount: number;
  catalogItemCount: number;
  pendingCategories: number;
  pendingCatalogItems: number;
}

export interface OverviewMetrics {
  today: {
    newUsers: number;
    orderCount: number;
    revenue: number;
  };
  allTime: {
    totalUsers: number;
    totalOrders: number;
    totalRevenue: number;
    activeSellers: number;
    pendingCategories: number;
    pendingCatalogItems: number;
  };
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsers({ from, to }: MetricsPeriodQueryDto): Promise<UsersMetrics> {
    const [newInPeriod, totalUsers] = await Promise.all([
      this.prisma.user.count({
        where: { createdAt: this.periodWhere(from, to) },
      }),
      this.prisma.user.count(),
    ]);
    return { newInPeriod, totalUsers };
  }

  async getOrders({ from, to }: MetricsPeriodQueryDto): Promise<OrdersMetrics> {
    const createdAt = this.periodWhere(from, to);

    const [aggregate, groups] = await Promise.all([
      this.prisma.order.aggregate({
        where: { createdAt, status: { not: OrderStatus.CANCELLED } },
        _count: true,
        _sum: { itemsTotal: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt },
        _count: true,
        _sum: { itemsTotal: true },
      }),
    ]);

    const orderCount = aggregate._count;
    const revenue = aggregate._sum.itemsTotal ?? 0;

    return {
      orderCount,
      revenue,
      averageOrderValue: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
      byStatus: groups.map((g) => ({
        status: g.status,
        count: g._count,
        total: g._sum.itemsTotal ?? 0,
      })),
    };
  }

  async getCatalog(): Promise<CatalogMetrics> {
    const [
      activeSellers,
      listingCount,
      catalogItemCount,
      pendingCategories,
      pendingCatalogItems,
    ] = await Promise.all([
      this.prisma.seller.count({ where: { status: SellerStatus.ACTIVE } }),
      this.prisma.listing.count(),
      this.prisma.catalogItem.count(),
      this.prisma.category.count({ where: { status: ReviewStatus.PENDING } }),
      this.prisma.catalogItem.count({
        where: { status: ReviewStatus.PENDING },
      }),
    ]);

    return {
      activeSellers,
      listingCount,
      catalogItemCount,
      pendingCategories,
      pendingCatalogItems,
    };
  }

  async getOverview(): Promise<OverviewMetrics> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [todayUsers, todayOrders, totalUsers, allOrders, catalog] =
      await Promise.all([
        this.getUsers({ from: startOfDay }),
        this.getOrders({ from: startOfDay }),
        this.prisma.user.count(),
        this.prisma.order.aggregate({
          where: { status: { not: OrderStatus.CANCELLED } },
          _count: true,
          _sum: { itemsTotal: true },
        }),
        this.getCatalog(),
      ]);

    return {
      today: {
        newUsers: todayUsers.newInPeriod,
        orderCount: todayOrders.orderCount,
        revenue: todayOrders.revenue,
      },
      allTime: {
        totalUsers,
        totalOrders: allOrders._count,
        totalRevenue: allOrders._sum.itemsTotal ?? 0,
        activeSellers: catalog.activeSellers,
        pendingCategories: catalog.pendingCategories,
        pendingCatalogItems: catalog.pendingCatalogItems,
      },
    };
  }

  // Границы дня — UTC, без учёта таймзоны Узбекистана: время сервера уже UTC,
  // а отдельного таймзонного хелпера в проекте нет.
  private periodWhere(
    from?: Date,
    to?: Date,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    return { ...(from && { gte: from }), ...(to && { lte: to }) };
  }
}
