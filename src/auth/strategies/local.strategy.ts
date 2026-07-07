import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

// Стратегия для админки: email + password (вход по форме).
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly auth: AuthService) {
    // passport-local по умолчанию ждёт поле username — маппим на email.
    super({ usernameField: 'email', passwordField: 'password' });
  }

  validate(email: string, password: string): Promise<AuthUser> {
    return this.auth.validateCredentials(email, password);
  }
}
