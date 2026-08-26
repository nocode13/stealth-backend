import type { ConfigService } from '@nestjs/config';
import { normalizeEmail } from './email';

/**
 * Тестовый аккаунт для проверки в Play Store: ревьюер логинится фиксированным
 * адресом и вечным кодом, минуя реальную отправку письма через Resend
 * (см. `EmailAuthService`).
 *
 * Опознаём его по `User.email`, а не по колонке в БД: сущность без собственных
 * полей не заводим, а флаг целиком выводится из env + `User.email`. Условие
 * «заданы ОБЕ переменные» — то же, что включает сам байпас: с пустыми env этот
 * адрес логинится обычным путём и тестовым не считается.
 *
 * Из вывода по адресу следует запрет на правку профиля (`UsersService.updateProfile`):
 * email вообще не редактируется через `PATCH /me` ни у кого, а привязка/смена почты
 * (`EmailAuthService.createLinkSession`/`verifyLink`) тестовому аккаунту недоступна —
 * иначе следующий вход по `TEST_LOGIN_EMAIL` завёл бы новую учётку.
 */
export function isTestAccount(
  email: string | null,
  config: ConfigService,
): boolean {
  if (!email) return false;
  const testEmail = config.get<string>('testLogin.email');
  const otp = config.get<string>('testLogin.otp');
  if (!testEmail || !otp) return false;
  return normalizeEmail(email) === normalizeEmail(testEmail);
}
