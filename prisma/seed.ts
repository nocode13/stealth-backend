import { PrismaClient, Role, ListingStatus, CatalogItem } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  // Платформенный супер-админ (управляет справочником и продавцами).
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

  // Единственный пока продавец + его владелец.
  const sellerOwner = await prisma.user.upsert({
    where: { email: 'seller@stealth.local' },
    update: {},
    create: {
      phone: '+998900000002',
      email: 'seller@stealth.local',
      passwordHash,
      role: Role.SELLER,
    },
  });

  const seller = await prisma.seller.upsert({
    where: { ownerUserId: sellerOwner.id },
    update: {},
    create: {
      name: 'Первый цветочный',
      ownerUserId: sellerOwner.id,
    },
  });

  // Привяжем владельца к его продавцу.
  await prisma.user.update({
    where: { id: sellerOwner.id },
    data: { sellerId: seller.id },
  });

  // Справочник цветов.
  const catalogSeed = [
    { name: 'Красная роза', slug: 'red-rose', category: 'Розы' },
    { name: 'Белая роза', slug: 'white-rose', category: 'Розы' },
    { name: 'Тюльпан', slug: 'tulip', category: 'Тюльпаны' },
    { name: 'Пион', slug: 'peony', category: 'Пионы' },
    { name: 'Хризантема', slug: 'chrysanthemum', category: 'Хризантемы' },
  ];

  const catalogItems: CatalogItem[] = [];
  for (const item of catalogSeed) {
    catalogItems.push(
      await prisma.catalogItem.upsert({
        where: { slug: item.slug },
        update: {},
        create: item,
      }),
    );
  }

  // Пара листингов продавца поверх справочника.
  await prisma.listing.upsert({
    where: {
      sellerId_catalogItemId: {
        sellerId: seller.id,
        catalogItemId: catalogItems[0].id,
      },
    },
    update: {},
    create: {
      sellerId: seller.id,
      catalogItemId: catalogItems[0].id,
      price: 25000,
      stock: 100,
      status: ListingStatus.ACTIVE,
    },
  });

  await prisma.listing.upsert({
    where: {
      sellerId_catalogItemId: {
        sellerId: seller.id,
        catalogItemId: catalogItems[2].id,
      },
    },
    update: {},
    create: {
      sellerId: seller.id,
      catalogItemId: catalogItems[2].id,
      price: 15000,
      stock: 200,
      status: ListingStatus.ACTIVE,
    },
  });

  console.log('Seed complete:', {
    admin: admin.email,
    seller: seller.name,
    catalogItems: catalogItems.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
