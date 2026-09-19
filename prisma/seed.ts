import { Locale, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Стартовый справочник стран. Расширяется из админки, не кодом.
// «Голландия» — разговорное название Нидерландов, оставлено как просил заказчик;
// формальный вариант правится из админки, не кодом.
const COUNTRIES: { code: string; names: Record<Locale, string> }[] = [
  { code: 'CN', names: { RU: 'Китай', UZ: 'Xitoy', EN: 'China' } },
  { code: 'NL', names: { RU: 'Голландия', UZ: 'Gollandiya', EN: 'Netherlands' } },
];

async function main() {
  // На проде пароль задаётся через env, дефолт — только для локальной разработки.
  // || а не ??: пустая строка в .env должна падать в дефолт, а не хешироваться.
  const password = process.env.SEED_ADMIN_PASSWORD || 'password123';
  const passwordHash = await bcrypt.hash(password, 10);

  // Платформенный супер-админ (управляет справочником и продавцами).
  // Всё остальное — продавцы, категории, каталог — заводится через админку.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@stealth.local' },
    update: {},
    create: {
      phone: '+998900000001',
      email: 'admin@stealth.local',
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  // Заводим страны идемпотентно: update: {} — чтобы не затирать переводы,
  // которые супер-админ уже поправил руками.
  for (const { code, names } of COUNTRIES) {
    await prisma.country.upsert({
      where: { code },
      // Пусто намеренно: переводы, поправленные супер-админом, сид не затирает.
      update: {},
      create: {
        code,
        translations: {
          create: (Object.keys(names) as Locale[]).map((locale) => ({
            locale,
            name: names[locale],
            auto: false,
          })),
        },
      },
    });
  }

  console.log('Seed complete:', {
    admin: admin.email,
    countries: COUNTRIES.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
