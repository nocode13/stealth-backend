import type {
  Locale,
  OrderGroupStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import type { StorageService } from '../storage/storage.service';
import { pickText } from '../i18n/localized-text';
import { pickTranslation } from '../i18n/pick';
import type { OrderGroupWithOrders, OrderWithDetails } from './orders.service';

// Prisma отдаёт сущность как есть, а её колонки — не то же самое, что API-контракт:
// userId/sellerId рядом с seller/updatedAt/listingId/changedByUserId/groupId нет ни
// на одном экране. Маппер живёт в домене и зовётся ОБЕИМИ поверхностями
// (admin-orders.controller.ts и мобильный mobile-order-groups.controller.ts).
//
// Группа — корень: у Order своего вложенного group нет (циклов нет). Это
// единственная форма ответа — см. AGENTS.md «Заказы».

export interface OrderResponse {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  seller: { id: string; name: string };
  // Доля этого продавца — доставка на Order не раскладывается, она платформенная
  // и живёт целиком в OrderGroupResponse.deliveryFee/total.
  itemsTotal: number;
  courierName: string | null;
  courierPhone: string | null;
  cancelReason: string | null;
  items: {
    id: string;
    catalogItemName: string;
    catalogItemImageUrl: string | null;
    unit: string;
    price: number;
    quantity: number;
    total: number;
  }[];
  history: {
    id: string;
    status: OrderStatus;
    comment: string | null;
    createdAt: Date;
  }[];
  createdAt: Date;
  confirmedAt: Date | null;
  deliveredAt: Date | null;
}

export interface OrderGroupResponse {
  id: string;
  groupNumber: number;
  status: OrderGroupStatus;
  contactName: string;
  contactPhone: string;
  deliveryAddress: string;
  deliveryComment: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  // Сколько заказов ВИДНО в этом ответе — у SELLER это не общее число заказов
  // в группе, а только те, что принадлежат ему (см. toSellerOrderGroupResponse).
  ordersCount: number;
  createdAt: Date;
  orders: OrderResponse[];
  // Таймлайн статуса ГРУППЫ — не путать с history внутри каждого OrderResponse.
  // Не отфильтрован по продавцу, как и status: SELLER видит его целиком.
  history: {
    id: string;
    status: OrderGroupStatus;
    comment: string | null;
    createdAt: Date;
  }[];
}

export const toOrderResponse = (
  o: OrderWithDetails,
  storage: StorageService,
  locale: Locale,
): OrderResponse => ({
  id: o.id,
  orderNumber: o.orderNumber,
  status: o.status,
  seller: {
    id: o.seller.id,
    name: pickTranslation(o.seller.translations, locale).name,
  },
  itemsTotal: o.itemsTotal,
  courierName: o.courierName,
  courierPhone: o.courierPhone,
  cancelReason: o.cancelReason,
  items: o.items.map((item) => ({
    id: item.id,
    catalogItemName: pickText(item.catalogItemName, locale),
    catalogItemImageUrl: storage.getUrlOrNull(item.catalogItemImageUrl),
    unit: pickText(item.unit, locale),
    price: item.price,
    quantity: item.quantity,
    total: item.total,
  })),
  history: o.history.map((h) => ({
    id: h.id,
    status: h.status,
    comment: h.comment,
    createdAt: h.createdAt,
  })),
  createdAt: o.createdAt,
  confirmedAt: o.confirmedAt,
  deliveredAt: o.deliveredAt,
});

export const toOrderGroupResponse = (
  g: OrderGroupWithOrders,
  storage: StorageService,
  locale: Locale,
): OrderGroupResponse => ({
  id: g.id,
  groupNumber: g.groupNumber,
  status: g.status,
  contactName: g.contactName,
  contactPhone: g.contactPhone,
  deliveryAddress: g.deliveryAddress,
  deliveryComment: g.deliveryComment,
  deliveryLat: g.deliveryLat,
  deliveryLng: g.deliveryLng,
  paymentMethod: g.paymentMethod,
  paymentStatus: g.paymentStatus,
  itemsTotal: g.itemsTotal,
  deliveryFee: g.deliveryFee,
  total: g.total,
  ordersCount: g.orders.length,
  createdAt: g.createdAt,
  orders: g.orders.map((o) => toOrderResponse(o, storage, locale)),
  history: g.history.map((h) => ({
    id: h.id,
    status: h.status,
    comment: h.comment,
    createdAt: h.createdAt,
  })),
});

/**
 * Ответ продавцу: заказы уже отфильтрованы запросом (только его), поэтому суммы
 * пересчитываются по видимым — иначе SELLER узнал бы оборот соседа по группе.
 * Доставка платформенная, к его выручке отношения не имеет, поэтому 0.
 */
export const toSellerOrderGroupResponse = (
  g: OrderGroupWithOrders,
  storage: StorageService,
  locale: Locale,
): OrderGroupResponse => {
  const base = toOrderGroupResponse(g, storage, locale);
  const itemsTotal = base.orders.reduce((sum, o) => sum + o.itemsTotal, 0);
  return { ...base, itemsTotal, deliveryFee: 0, total: itemsTotal };
};
