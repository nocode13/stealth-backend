import { Locale, OrderGroupStatus, OrderStatus } from '@prisma/client';

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

/**
 * Что видит покупатель, когда меняется статус его ГРУППЫ — для него заказ это
 * именно группа (плоских /mobile/orders нет), поэтому карта ключуется
 * OrderGroupStatus, а не OrderStatus: уведомление на каждый Order из
 * мультипродавцового чекаута было бы тремя сообщениями об одном событии.
 *
 * CONFIRMED — «заказ принят», без упоминания продавца: у группы этот статус
 * появляется, только когда подтвердили ВСЕ продавцы (см. deriveGroupStatus).
 *
 * Ключуется ЕЩЁ и локалью (User.locale, см. OrderNotifier.groupStatusChanged) —
 * пуши и Telegram-DM уходят вне HTTP-запроса, заголовка Accept-Language там нет.
 */
export const CUSTOMER_GROUP_STATUS_MESSAGES: Record<
  Locale,
  Partial<Record<OrderGroupStatus, string>>
> = {
  RU: {
    [OrderGroupStatus.CONFIRMED]: 'Заказ принят.',
    [OrderGroupStatus.ASSEMBLING]: 'Ваш заказ собирают.',
    [OrderGroupStatus.DELIVERING]: 'Заказ передан курьеру и едет к вам.',
    [OrderGroupStatus.ARRIVED]: '🚗 Курьер на месте! Выходите, пожалуйста.',
    [OrderGroupStatus.PARTIALLY_DELIVERED]:
      'Часть заказа доставлена, остальное в пути.',
    [OrderGroupStatus.DELIVERED]: 'Заказ доставлен. Спасибо за покупку!',
    [OrderGroupStatus.CANCELLED]: 'Заказ отменён.',
    // NEW не шлём: покупатель только что оформил заказ сам, он и так это знает.
  },
  UZ: {
    [OrderGroupStatus.CONFIRMED]: 'Buyurtma qabul qilindi.',
    [OrderGroupStatus.ASSEMBLING]: "Buyurtmangiz yig'ilmoqda.",
    [OrderGroupStatus.DELIVERING]:
      'Buyurtma kuryerga topshirildi va sizga yetib bormoqda.',
    [OrderGroupStatus.ARRIVED]: "🚗 Kuryer joyida! Chiqsangiz bo'ladi.",
    [OrderGroupStatus.PARTIALLY_DELIVERED]:
      "Buyurtmaning bir qismi yetkazildi, qolgani yo'lda.",
    [OrderGroupStatus.DELIVERED]:
      'Buyurtma yetkazildi. Xaridingiz uchun rahmat!',
    [OrderGroupStatus.CANCELLED]: 'Buyurtma bekor qilindi.',
  },
  EN: {
    [OrderGroupStatus.CONFIRMED]: 'Your order has been confirmed.',
    [OrderGroupStatus.ASSEMBLING]: 'Your order is being prepared.',
    [OrderGroupStatus.DELIVERING]: 'Your order is on its way with the courier.',
    [OrderGroupStatus.ARRIVED]: '🚗 The courier has arrived! Please come out.',
    [OrderGroupStatus.PARTIALLY_DELIVERED]:
      'Part of your order has been delivered, the rest is on the way.',
    [OrderGroupStatus.DELIVERED]:
      'Order delivered. Thank you for your purchase!',
    [OrderGroupStatus.CANCELLED]: 'Order cancelled.',
  },
};

/** Заголовок пуша/DM: «Заказ №12» на языке покупателя. */
export const ORDER_TITLE: Record<Locale, string> = {
  RU: 'Заказ',
  UZ: 'Buyurtma',
  EN: 'Order',
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
