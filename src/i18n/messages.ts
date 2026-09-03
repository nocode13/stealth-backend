import { Locale } from '@prisma/client';

// Ключи ошибок, которые видит покупатель (мобилка). Ошибки чисто админских
// путей (см. AGENTS.md/PLAN «Правило границы») остаются обычными русскими
// строками в BadRequestException/… и через этот словарь не проходят.
export const ERRORS = {
  LISTING_NOT_FOUND: 'errors.listing_not_found',
  LISTING_UNAVAILABLE: 'errors.listing_unavailable',
  NOT_ENOUGH_STOCK: 'errors.not_enough_stock',
  CART_ITEM_NOT_FOUND: 'errors.cart_item_not_found',
  FOREIGN_CART: 'errors.foreign_cart',
  CART_EMPTY: 'errors.cart_empty',
  ITEM_SOLD_OUT: 'errors.item_sold_out', // {name}
  ITEM_STOCK_LIMITED: 'errors.item_stock_limited', // {name, stock}
  ITEM_TAKEN_DURING_CHECKOUT: 'errors.item_taken_during_checkout', // {name}
  ORDER_NOT_FOUND: 'errors.order_not_found',
  FOREIGN_ORDER: 'errors.foreign_order',
  ORDER_ALREADY_FINISHED: 'errors.order_already_finished',
  ORDER_ALREADY_ASSEMBLING: 'errors.order_already_assembling',
  ADDRESS_NOT_FOUND: 'errors.address_not_found',
  FOREIGN_ADDRESS: 'errors.foreign_address',
  CATEGORY_NOT_FOUND: 'errors.category_not_found',
  CATALOG_ITEM_NOT_FOUND: 'errors.catalog_item_not_found',
  SELLER_NOT_FOUND: 'errors.seller_not_found',
  INVALID_CODE: 'errors.invalid_code',
  SESSION_EXPIRED: 'errors.session_expired',
  SESSION_ALREADY_USED: 'errors.session_already_used',
  SESSION_MISMATCH: 'errors.session_mismatch',
  TOO_MANY_ATTEMPTS: 'errors.too_many_attempts',
  EMAIL_RATE_LIMITED: 'errors.email_rate_limited',
  EMAIL_TAKEN: 'errors.email_taken',
  PHONE_TAKEN: 'errors.phone_taken',
  ACCOUNT_DELETED: 'errors.account_deleted',
  TEST_ACCOUNT_READONLY: 'errors.test_account_readonly',
  TEST_ACCOUNT_NO_DELETE: 'errors.test_account_no_delete',
  USER_NOT_FOUND: 'errors.user_not_found',
  PHONE_IMMUTABLE: 'errors.phone_immutable',
  ACTIVE_ORDERS_BLOCK_DELETE: 'errors.active_orders_block_delete',
  EMAIL_LOGIN_DISABLED: 'errors.email_login_disabled',
  EMAIL_SEND_FAILED: 'errors.email_send_failed',
  INVALID_CREDENTIALS: 'errors.invalid_credentials',
  INVALID_REFRESH_TOKEN: 'errors.invalid_refresh_token',
  REFRESH_TOKEN_REVOKED: 'errors.refresh_token_revoked',
} as const;

export const ERROR_MESSAGES: Record<string, Record<Locale, string>> = {
  [ERRORS.LISTING_NOT_FOUND]: {
    RU: 'Листинг не найден',
    UZ: "E'lon topilmadi",
    EN: 'Listing not found',
  },
  [ERRORS.LISTING_UNAVAILABLE]: {
    RU: 'Листинг недоступен',
    UZ: "E'lon mavjud emas",
    EN: 'Listing unavailable',
  },
  [ERRORS.NOT_ENOUGH_STOCK]: {
    RU: 'Недостаточно товара на складе',
    UZ: "Omborda yetarli mahsulot yo'q",
    EN: 'Not enough stock',
  },
  [ERRORS.CART_ITEM_NOT_FOUND]: {
    RU: 'Позиция корзины не найдена',
    UZ: 'Savat elementi topilmadi',
    EN: 'Cart item not found',
  },
  [ERRORS.FOREIGN_CART]: {
    RU: 'Чужая корзина',
    UZ: 'Bu boshqa foydalanuvchining savati',
    EN: 'This cart belongs to another user',
  },
  [ERRORS.CART_EMPTY]: {
    RU: 'Корзина пуста',
    UZ: "Savat bo'sh",
    EN: 'Cart is empty',
  },
  [ERRORS.ITEM_SOLD_OUT]: {
    RU: '«{name}» больше не продаётся',
    UZ: '«{name}» endi sotuvda emas',
    EN: '"{name}" is no longer available',
  },
  [ERRORS.ITEM_STOCK_LIMITED]: {
    RU: '«{name}»: в наличии только {stock}',
    UZ: '«{name}»: faqat {stock} dona qoldi',
    EN: '"{name}": only {stock} left in stock',
  },
  [ERRORS.ITEM_TAKEN_DURING_CHECKOUT]: {
    RU: '«{name}» разобрали, пока вы оформляли заказ',
    UZ: '«{name}» siz buyurtma berayotganda sotildi',
    EN: '"{name}" was just sold out while you were checking out',
  },
  [ERRORS.ORDER_NOT_FOUND]: {
    RU: 'Заказ не найден',
    UZ: 'Buyurtma topilmadi',
    EN: 'Order not found',
  },
  [ERRORS.FOREIGN_ORDER]: {
    RU: 'Чужой заказ',
    UZ: 'Bu boshqa foydalanuvchining buyurtmasi',
    EN: 'This order belongs to another user',
  },
  [ERRORS.ORDER_ALREADY_FINISHED]: {
    RU: 'Заказ уже завершён',
    UZ: 'Buyurtma allaqachon yakunlangan',
    EN: 'Order is already finished',
  },
  [ERRORS.ORDER_ALREADY_ASSEMBLING]: {
    RU: 'Заказ уже собирается — отмену согласуйте с продавцом',
    UZ: "Buyurtma allaqachon yig'ilmoqda — bekor qilish uchun sotuvchi bilan bog'laning",
    EN: 'Order is already being prepared — contact the seller to cancel',
  },
  [ERRORS.ADDRESS_NOT_FOUND]: {
    RU: 'Адрес не найден',
    UZ: 'Manzil topilmadi',
    EN: 'Address not found',
  },
  [ERRORS.FOREIGN_ADDRESS]: {
    RU: 'Чужой адрес',
    UZ: 'Bu boshqa foydalanuvchining manzili',
    EN: 'This address belongs to another user',
  },
  [ERRORS.CATEGORY_NOT_FOUND]: {
    RU: 'Категория не найдена',
    UZ: 'Kategoriya topilmadi',
    EN: 'Category not found',
  },
  [ERRORS.CATALOG_ITEM_NOT_FOUND]: {
    RU: 'Позиция справочника не найдена',
    UZ: 'Mahsulot topilmadi',
    EN: 'Catalog item not found',
  },
  [ERRORS.SELLER_NOT_FOUND]: {
    RU: 'Продавец не найден',
    UZ: 'Sotuvchi topilmadi',
    EN: 'Seller not found',
  },
  [ERRORS.INVALID_CODE]: {
    RU: 'Неверный код',
    UZ: "Kod noto'g'ri",
    EN: 'Invalid code',
  },
  [ERRORS.SESSION_EXPIRED]: {
    RU: 'Сессия входа устарела, начните заново',
    UZ: 'Kirish sessiyasi eskirgan, qaytadan boshlang',
    EN: 'Login session expired, please start again',
  },
  [ERRORS.SESSION_ALREADY_USED]: {
    RU: 'Сессия входа уже использована',
    UZ: 'Kirish sessiyasi allaqachon ishlatilgan',
    EN: 'Login session already used',
  },
  [ERRORS.SESSION_MISMATCH]: {
    RU: 'Сессия входа не принадлежит этому аккаунту',
    UZ: 'Kirish sessiyasi ushbu akkauntga tegishli emas',
    EN: 'Login session does not belong to this account',
  },
  [ERRORS.TOO_MANY_ATTEMPTS]: {
    RU: 'Слишком много попыток, начните заново',
    UZ: "Juda ko'p urinish, qaytadan boshlang",
    EN: 'Too many attempts, please start again',
  },
  [ERRORS.EMAIL_RATE_LIMITED]: {
    RU: 'Слишком много попыток входа. Попробуйте позже.',
    UZ: "Kirish urinishlari juda ko'p. Birozdan so'ng qayta urining.",
    EN: 'Too many login attempts. Please try again later.',
  },
  [ERRORS.EMAIL_TAKEN]: {
    RU: 'Этот email уже привязан к другому аккаунту',
    UZ: "Bu email allaqachon boshqa akkauntga bog'langan",
    EN: 'This email is already linked to another account',
  },
  [ERRORS.PHONE_TAKEN]: {
    RU: 'Этот телефон уже привязан к другому аккаунту',
    UZ: "Bu telefon raqami allaqachon boshqa akkauntga bog'langan",
    EN: 'This phone number is already linked to another account',
  },
  [ERRORS.ACCOUNT_DELETED]: {
    RU: 'Аккаунт удалён',
    UZ: "Akkaunt o'chirilgan",
    EN: 'Account deleted',
  },
  [ERRORS.TEST_ACCOUNT_READONLY]: {
    RU: 'Тестовый аккаунт нельзя редактировать',
    UZ: "Test akkauntni tahrirlab bo'lmaydi",
    EN: 'Test account cannot be edited',
  },
  [ERRORS.TEST_ACCOUNT_NO_DELETE]: {
    RU: 'Тестовый аккаунт нельзя удалить',
    UZ: "Test akkauntni o'chirib bo'lmaydi",
    EN: 'Test account cannot be deleted',
  },
  [ERRORS.USER_NOT_FOUND]: {
    RU: 'Пользователь не найден',
    UZ: 'Foydalanuvchi topilmadi',
    EN: 'User not found',
  },
  [ERRORS.PHONE_IMMUTABLE]: {
    RU: 'Номер телефона изменить нельзя',
    UZ: "Telefon raqamini o'zgartirib bo'lmaydi",
    EN: 'Phone number cannot be changed',
  },
  [ERRORS.ACTIVE_ORDERS_BLOCK_DELETE]: {
    RU: 'Сначала завершите или отмените активные заказы',
    UZ: 'Avval faol buyurtmalarni yakunlang yoki bekor qiling',
    EN: 'Please finish or cancel your active orders first',
  },
  [ERRORS.EMAIL_LOGIN_DISABLED]: {
    RU: 'Вход по почте не сконфигурирован',
    UZ: 'Email orqali kirish sozlanmagan',
    EN: 'Email login is not configured',
  },
  [ERRORS.EMAIL_SEND_FAILED]: {
    RU: 'Не удалось отправить письмо',
    UZ: "Xat yuborib bo'lmadi",
    EN: 'Failed to send email',
  },
  [ERRORS.INVALID_CREDENTIALS]: {
    RU: 'Неверный email или пароль',
    UZ: "Email yoki parol noto'g'ri",
    EN: 'Invalid email or password',
  },
  [ERRORS.INVALID_REFRESH_TOKEN]: {
    RU: 'Невалидный refresh-токен',
    UZ: 'Refresh-token yaroqsiz',
    EN: 'Invalid refresh token',
  },
  [ERRORS.REFRESH_TOKEN_REVOKED]: {
    RU: 'Refresh-токен отозван или истёк',
    UZ: "Refresh-token bekor qilingan yoki muddati o'tgan",
    EN: 'Refresh token revoked or expired',
  },
};

export function translateError(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string | null {
  const template = ERROR_MESSAGES[key]?.[locale];
  if (!template) return null;
  if (!params) return template;
  return Object.entries(params).reduce(
    (text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
    template,
  );
}
