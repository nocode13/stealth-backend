import * as Joi from 'joi';

// Валидация переменных окружения при старте приложения.
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGIN: Joi.string().default('*'),

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  SESSION_SECRET: Joi.string().required(),

  // Telegram — единственный способ входа в мобилку.
  // Токен/username optional: без них приложение поднимается, но бот не стартует
  // (логируется warning) — удобно для тестов и админских сборок.
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),
  TELEGRAM_BOT_USERNAME: Joi.string().allow('').optional(),
  TELEGRAM_USE_WEBHOOK: Joi.boolean().default(false),
  TELEGRAM_WEBHOOK_URL: Joi.string().allow('').optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  TG_AUTH_SESSION_TTL_SECONDS: Joi.number().default(180),

  // S3-совместимое хранилище фото (локально — MinIO из docker-compose).
  S3_ENDPOINT: Joi.string().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().default('catalog'),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_PUBLIC_URL: Joi.string().required(),
});

// Типизированный доступ к конфигу через ConfigService.
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: (process.env.CORS_ORIGIN ?? '*').split(',').map((s) => s.trim()),
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
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'catalog',
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    publicUrl: process.env.S3_PUBLIC_URL,
  },
});
