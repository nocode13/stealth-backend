-- Удаление аккаунта покупателя (требование Google Play) + push-токены.
--
-- users.deletedAt: строку юзера не удаляем — Order.userId стоит ON DELETE RESTRICT,
-- а заказы обязаны пережить удаление ради отчётности. Вместо этого обнуляем
-- профильные колонки (phone/email/telegramId — они nullable+unique, так что
-- освобождаются под повторную регистрацию) и ставим метку, по которой вход
-- запрещён.
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Push-токен Expo конкретной УСТАНОВКИ приложения. unique по самому токену,
-- а не по паре (userId, token): если на устройстве вошёл другой юзер, строка
-- должна переехать к нему, иначе пуши продолжат уходить прошлому владельцу.
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
