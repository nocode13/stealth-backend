import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Защита роутов мобилки: требует валидный Bearer access-token.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
