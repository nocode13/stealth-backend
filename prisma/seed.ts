import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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

  console.log('Seed complete:', { admin: admin.email });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
