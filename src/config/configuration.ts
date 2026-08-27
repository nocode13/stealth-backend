import * as Joi from 'joi';

// Валидация переменных окружения при старте приложения.
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGIN: Joi.string().default('*'),
  // Публичный адрес админки: из него строится ссылка «Открыть в админке»,
  // которую бот кладёт в уведомление продавцу о новом заказе.
  ADMIN_URL: Joi.string().default('http://localhost:5173'),

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  SESSION_SECRET: Joi.string().required(),

  // Основной бот: вход покупателя в мобилку и уведомления ему же.
  // Токен/username optional: без них приложение поднимается, но бот не стартует
  // (логируется warning) — удобно для тестов и админских сборок.
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),
  TELEGRAM_BOT_USERNAME: Joi.string().allow('').optional(),
  TELEGRAM_USE_WEBHOOK: Joi.boolean().default(false),
  TELEGRAM_WEBHOOK_URL: Joi.string().allow('').optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  TG_AUTH_SESSION_TTL_SECONDS: Joi.number().default(180),

  // Бот продавца: кабинет и уведомления о заказах. Отдельный бот, потому что один
  // и тот же человек может быть и покупателем, и продавцом. Режим (вебхук/поллинг)
  // общий с основным; URL вебхука производный — `${TELEGRAM_WEBHOOK_URL}/seller`.
  TELEGRAM_SELLER_BOT_TOKEN: Joi.string().allow('').optional(),
  TELEGRAM_SELLER_BOT_USERNAME: Joi.string().allow('').optional(),
  TELEGRAM_SELLER_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  // Вход по коду на почту (Resend). Пусто → приложение поднимается, в лог уходит
  // warning, POST /mobile/auth/email/session отвечает 400 (тот же приём, что с
  // TELEGRAM_BOT_TOKEN/REDIS_URL). RESEND_FROM — адрес отправителя вида
  // `Egen <noreply@egen.uz>`; домен обязан быть верифицирован в Resend, иначе
  // письма уходят только на собственный адрес аккаунта (локально можно гонять
  // на onboarding@resend.dev).
  RESEND_API_KEY: Joi.string().allow('').optional(),
  RESEND_FROM: Joi.string().allow('').optional(),
  EMAIL_AUTH_SESSION_TTL_SECONDS: Joi.number().default(600),

  // Тестовый аккаунт для проверки в Play Store: с этим адресом вход идёт мимо
  // Resend, а кодом служит вечный TEST_LOGIN_OTP. Работает, только если обе
  // переменные непустые; по умолчанию выключено.
  TEST_LOGIN_EMAIL: Joi.string().allow('').optional(),
  TEST_LOGIN_OTP: Joi.string().allow('').optional(),

  // S3-совместимое хранилище фото (локально — MinIO из docker-compose).
  S3_ENDPOINT: Joi.string().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().default('catalog'),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_PUBLIC_URL: Joi.string().required(),

  // Redis — кеш публичной витрины мобилки. Переменная optional намеренно: пустая
  // или отсутствующая = кеш выключен, приложение поднимается и ходит прямо в БД
  // (тот же приём, что с TELEGRAM_BOT_TOKEN).
  REDIS_URL: Joi.string().allow('').optional(),
  CACHE_TTL_SECONDS: Joi.number().default(60),

  // Push-уведомления через Expo Push Service. Токен доступа нужен только если в
  // кабинете Expo включена «Enhanced Security for Push Notifications»; без него
  // отправка тоже работает. Пусто = как у TELEGRAM_BOT_TOKEN, просто без токена.
  EXPO_ACCESS_TOKEN: Joi.string().allow('').optional(),
});

// Типизированный доступ к конфигу через ConfigService.
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: (process.env.CORS_ORIGIN ?? '*').split(',').map((s) => s.trim()),
  adminUrl: (process.env.ADMIN_URL ?? 'http://localhost:5173').replace(
    /\/+$/,
    '',
  ),
  database: {
    url: process.env.DATABASE_URL!,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  session: {
    secret: process.env.SESSION_SECRET!,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
    useWebhook: process.env.TELEGRAM_USE_WEBHOOK === 'true',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    authSessionTtlSeconds: parseInt(
      process.env.TG_AUTH_SESSION_TTL_SECONDS ?? '180',
      10,
    ),
  },
  telegramSeller: {
    botToken: process.env.TELEGRAM_SELLER_BOT_TOKEN,
    botUsername: process.env.TELEGRAM_SELLER_BOT_USERNAME,
    webhookSecret: process.env.TELEGRAM_SELLER_WEBHOOK_SECRET,
  },
  mail: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM,
    authSessionTtlSeconds: parseInt(
      process.env.EMAIL_AUTH_SESSION_TTL_SECONDS ?? '600',
      10,
    ),
  },
  // Байпас включён, только когда заданы обе переменные (см. EmailAuthService).
  testLogin: {
    email: process.env.TEST_LOGIN_EMAIL,
    otp: process.env.TEST_LOGIN_OTP,
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'catalog',
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    // Хвостовой слэш срезаем: StorageService.getUrl() склеивает ссылку по
    // `${publicUrl}/${key}`, и на двойном слэше она разъедется.
    publicUrl: process.env.S3_PUBLIC_URL?.replace(/\/+$/, ''),
  },
  cache: {
    url: process.env.REDIS_URL,
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS ?? '60', 10),
  },
  push: {
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN,
  },
});
