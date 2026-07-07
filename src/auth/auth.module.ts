import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { SessionSerializer } from './strategies/session.serializer';

@Module({
  imports: [
    UsersModule,
    // session: true — включает passport-сессии для админки.
    PassportModule.register({ session: true }),
    JwtModule.register({}), // секреты передаём per-sign в AuthService
  ],
  providers: [AuthService, JwtStrategy, LocalStrategy, SessionSerializer],
  exports: [AuthService],
})
export class AuthModule {}
