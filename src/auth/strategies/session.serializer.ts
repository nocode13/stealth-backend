import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

// Сериализация сессии админки: в cookie/store хранится только userId,
// на каждый запрос пользователь подтягивается из БД.
@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {
    super();
  }

  serializeUser(user: AuthUser, done: (err: Error | null, id: string) => void) {
    done(null, user.id);
  }

  async deserializeUser(
    userId: string,
    done: (err: Error | null, user: AuthUser | null) => void,
  ) {
    const user = await this.users.findById(userId);
    done(null, user ? this.auth.toAuthUser(user) : null);
  }
}
