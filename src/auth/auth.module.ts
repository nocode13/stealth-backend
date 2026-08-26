import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { EmailAuthService } from './email-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { SessionSerializer } from './strategies/session.serializer';

@Module({
  imports: [
    UsersModule,
    MailModule,
    // session: true — включает passport-сессии для админки.
    PassportModule.register({ session: true }),
    JwtModule.register({}), // секреты передаём per-sign в AuthService
  ],
  providers: [
    AuthService,
    EmailAuthService,
    JwtStrategy,
    LocalStrategy,
    SessionSerializer,
  ],
  exports: [AuthService, EmailAuthService],
})
export class AuthModule {}
