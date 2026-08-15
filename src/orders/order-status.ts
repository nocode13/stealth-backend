import { OrderGroupStatus, OrderStatus } from '@prisma/client';

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

/** Подписи статусов группы — переиспользуют ORDER_STATUS_LABELS, кроме своего значения. */
export const ORDER_GROUP_STATUS_LABELS: Record<OrderGroupStatus, string> = {
  [OrderGroupStatus.NEW]: ORDER_STATUS_LABELS[OrderStatus.NEW],
  [OrderGroupStatus.CONFIRMED]: ORDER_STATUS_LABELS[OrderStatus.CONFIRMED],
  [OrderGroupStatus.ASSEMBLING]: ORDER_STATUS_LABELS[OrderStatus.ASSEMBLING],
  [OrderGroupStatus.DELIVERING]: ORDER_STATUS_LABELS[OrderStatus.DELIVERING],
  [OrderGroupStatus.ARRIVED]: ORDER_STATUS_LABELS[OrderStatus.ARRIVED],
  [OrderGroupStatus.PARTIALLY_DELIVERED]: 'Частично доставлен',
  [OrderGroupStatus.DELIVERED]: ORDER_STATUS_LABELS[OrderStatus.DELIVERED],
  [OrderGroupStatus.CANCELLED]: ORDER_STATUS_LABELS[OrderStatus.CANCELLED],
};

// Нетерминальная шкала группы — только по ней ищем "минимальный" статус, когда
// доставка ещё не завершена ни у одного продавца.
const NON_TERMINAL_ORDER: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.ASSEMBLING,
  OrderStatus.DELIVERING,
  OrderStatus.ARRIVED,
];

/**
 * Статус группы ВЫВОДИТСЯ из статусов её заказов, а не выставляется руками:
 * второй карты переходов быть не должно (см. ALLOWED_TRANSITIONS). Порядок правил
 * ровно тот же, что в бэкфилле миграции 20260813120000_add_order_groups — карта
 * одна на двоих, расхождение читалось бы как баг.
 */
export function deriveGroupStatus(statuses: OrderStatus[]): OrderGroupStatus {
  // Пустая группа — баг вызывающего кода (заказ без единого Order невозможен по
  // схеме), а не «курьер на месте»: раньше пустой массив тихо давал ARRIVED.
  if (statuses.length === 0) {
    throw new Error(
      'deriveGroupStatus: у группы нет заказов — проверьте вызывающий код',
    );
  }

  const isCancelled = (s: OrderStatus) => s === OrderStatus.CANCELLED;
  const isDelivered = (s: OrderStatus) => s === OrderStatus.DELIVERED;

  if (statuses.every(isCancelled)) return OrderGroupStatus.CANCELLED;
  if (statuses.every(isDelivered)) return OrderGroupStatus.DELIVERED;

  // Смешанный случай (например, один CANCELLED + один CONFIRMED) намеренно не
  // получает отдельный статус группы — второй такой статус группы не заводим,
  // покупатель видит отменённую часть по статусу конкретного Order в ответе.
  const anyDelivered = statuses.some(isDelivered);
  if (anyDelivered) return OrderGroupStatus.PARTIALLY_DELIVERED;

  for (const candidate of NON_TERMINAL_ORDER) {
    if (statuses.includes(candidate)) {
      return OrderGroupStatus[candidate as keyof typeof OrderGroupStatus];
    }
  }
  // Недостижимо: единственный статус вне NON_TERMINAL_ORDER — CANCELLED, а он
  // либо покрыт every(isCancelled) выше, либо, в смешанном виде, соседствует
  // с каким-то нетерминальным статусом, который найдёт цикл.
  throw new Error(
    `deriveGroupStatus: непокрытая комбинация статусов: ${statuses.join(', ')}`,
  );
}
