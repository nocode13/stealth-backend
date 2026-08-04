import type { ConfigService } from '@nestjs/config';
import { normalizePhone } from './phone';

/**
 * Тестовый аккаунт для проверки в Play Store: у ревьюера нет доступа к нашему боту,
 * поэтому вход по `TEST_LOGIN_PHONE` идёт мимо Telegram (см. `PhoneAuthService`).
 *
 * Опознаём его по номеру, а не по колонке в БД: сущность без собственных полей не
 * заводим, а флаг целиком выводится из env + `User.phone`. Условие «заданы ОБЕ
 * переменные» — то же, что включает сам байпас: с пустыми env этот номер логинится
 * обычным путём и тестовым не считается.
 *
 * Из вывода по номеру следует запрет на правку профиля (`UsersService.updateProfile`):
 * смени тест-аккаунт себе телефон — и он перестанет быть тестовым, а следующий вход
 * по `TEST_LOGIN_PHONE` завёл бы новую учётку.
 */
export function isTestAccount(
  phone: string | null,
  config: ConfigService,
): boolean {
  if (!phone) return false;
  const testPhone = config.get<string>('testLogin.phone');
  const otp = config.get<string>('testLogin.otp');
  if (!testPhone || !otp) return false;
  return normalizePhone(phone) === normalizePhone(testPhone);
}
