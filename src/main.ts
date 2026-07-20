import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import session from 'express-session';
import passport from 'passport';
import connectPgSimple from 'connect-pg-simple';
import { AppModule } from './app.module';
import { AdminModule } from './admin/admin.module';
import { MobileModule } from './mobile/mobile.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const isProd = config.get<string>('nodeEnv') === 'production';

  // На хостинге (Railway) приложение стоит за прокси, который терминирует TLS.
  // Без trust proxy express-session считает соединение небезопасным и не ставит
  // cookie с secure: true — логин в админку молча ломается.
  if (isProd) {
    app.set('trust proxy', 1);
  }

  // Валидация DTO глобально.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS с поддержкой cookie (нужно для сессий админки).
  app.enableCors({
    origin: config.get<string[]>('corsOrigin'),
    credentials: true,
  });

  // Сессии админки — хранение в Postgres (connect-pg-simple).
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({
        conString:
          config.get<string>('database.url') ?? process.env.DATABASE_URL,
        createTableIfMissing: true,
      }),
      secret: config.get<string>('session.secret')!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // В проде админка живёт на другом домене, чем API, — cookie становится
        // cross-site, и браузер примет её только с sameSite=none + secure.
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Swagger: отдельные спеки для админки и мобилки.
  const adminDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Stealth — Admin API')
      .setDescription('API админки (session, httpOnly cookie)')
      .setVersion('0.1')
      .addCookieAuth('connect.sid')
      .build(),
    { include: [AdminModule] },
  );
  SwaggerModule.setup('docs/admin', app, adminDoc);

  const mobileDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Stealth — Mobile API')
      .setDescription('API мобилки (JWT Bearer, access + refresh)')
      .setVersion('0.1')
      .addBearerAuth()
      .build(),
    { include: [MobileModule] },
  );
  SwaggerModule.setup('docs/mobile', app, mobileDoc);

  const port = config.get<number>('port') ?? 3000;
  // 0.0.0.0, а не localhost: иначе прокси хостинга не достучится до контейнера.
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 http://localhost:${port} | docs: /docs/admin, /docs/mobile`);
}
void bootstrap();
