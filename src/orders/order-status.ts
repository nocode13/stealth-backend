import { OrderStatus } from '@prisma/client';

/**
 * Единственный источник правды по жизненному циклу заказа.
 *
 * Отсюда берут данные ВСЕ поверхности смены статуса: карточка заказа в Telegram-боте
 * (inline-кнопки), модалка в админке (список доступных статусов) и валидация в
 * OrdersService.changeStatus. Дублировать этот список где-либо ещё нельзя — иначе бот
 * и админка со временем разъедутся.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.NEW]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.ASSEMBLING, OrderStatus.CANCELLED],
  [OrderStatus.ASSEMBLING]: [OrderStatus.DELIVERING, OrderStatus.CANCELLED],
  // Курьер может доложить «я на месте», а может сразу закрыть заказ.
  [OrderStatus.DELIVERING]: [
    OrderStatus.ARRIVED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.ARRIVED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

/** Подписи статусов — для админки, бота и уведомлений покупателю. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: 'Новый',
  [OrderStatus.CONFIRMED]: 'Подтверждён',
  [OrderStatus.ASSEMBLING]: 'Собирается',
  [OrderStatus.DELIVERING]: 'В пути',
  [OrderStatus.ARRIVED]: 'Курьер на месте',
  [OrderStatus.DELIVERED]: 'Доставлен',
  [OrderStatus.CANCELLED]: 'Отменён',
};

/** Подписи кнопок действия — от лица продавца/курьера («что я сделал»). */
export const ORDER_ACTION_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: 'Вернуть в новые',
  [OrderStatus.CONFIRMED]: '✅ Принять заказ',
  [OrderStatus.ASSEMBLING]: '📦 Собираю',
  [OrderStatus.DELIVERING]: '🚚 Передал курьеру',
  [OrderStatus.ARRIVED]: '🚗 Я приехал',
  [OrderStatus.DELIVERED]: '✔️ Доставлен',
  [OrderStatus.CANCELLED]: '❌ Отменить',
};

/** Что видит покупатель, когда статус его заказа поменялся. */
export const CUSTOMER_STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.CONFIRMED]: 'Продавец принял ваш заказ.',
  [OrderStatus.ASSEMBLING]: 'Ваш заказ собирают.',
  [OrderStatus.DELIVERING]: 'Заказ передан курьеру и едет к вам.',
  [OrderStatus.ARRIVED]: '🚗 Курьер на месте! Выходите, пожалуйста.',
  [OrderStatus.DELIVERED]: 'Заказ доставлен. Спасибо за покупку!',
  [OrderStatus.CANCELLED]: 'Заказ отменён.',
  // NEW не шлём: покупатель только что оформил заказ сам, он и так это знает.
};

export const isTransitionAllowed = (
  from: OrderStatus,
  to: OrderStatus,
): boolean => ALLOWED_TRANSITIONS[from].includes(to);

/** Терминальные статусы — заказ дальше не двигается. */
export const isTerminal = (status: OrderStatus): boolean =>
  ALLOWED_TRANSITIONS[status].length === 0;
