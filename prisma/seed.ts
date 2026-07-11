import {
  PrismaClient,
  Role,
  ListingStatus,
  ReviewStatus,
  CatalogItem,
  Category,
} from '@prisma/client';
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

  // Master-категории (создаёт SUPER_ADMIN, сразу APPROVED).
  const categorySeed = [
    { nameRu: 'Розы', nameUz: 'Atirgullar', nameEn: 'Roses' },
    { nameRu: 'Тюльпаны', nameUz: 'Lolalar', nameEn: 'Tulips' },
    { nameRu: 'Пионы', nameUz: 'Piyonlar', nameEn: 'Peonies' },
    { nameRu: 'Хризантемы', nameUz: 'Xrizantemalar', nameEn: 'Chrysanthemums' },
  ];

  const categories: Category[] = [];
  for (const category of categorySeed) {
    const existing = await prisma.category.findFirst({
      where: { nameRu: category.nameRu, sellerId: null },
    });
    categories.push(
      existing ??
        (await prisma.category.create({
          data: { ...category, sellerId: null, status: ReviewStatus.APPROVED },
        })),
    );
  }
  const [roses, tulips, peonies, chrysanthemums] = categories;

  // Справочник цветов (master, создаёт SUPER_ADMIN).
  const catalogSeed = [
    { name: 'Красная роза', slug: 'red-rose', categoryId: roses.id },
    { name: 'Белая роза', slug: 'white-rose', categoryId: roses.id },
    { name: 'Тюльпан', slug: 'tulip', categoryId: tulips.id },
    { name: 'Пион', slug: 'peony', categoryId: peonies.id },
    {
      name: 'Хризантема',
      slug: 'chrysanthemum',
      categoryId: chrysanthemums.id,
    },
  ];

  const catalogItems: CatalogItem[] = [];
  for (const item of catalogSeed) {
    const existing = await prisma.catalogItem.findFirst({
      where: { slug: item.slug, sellerId: null },
    });
    catalogItems.push(
      existing ??
        (await prisma.catalogItem.create({
          data: { ...item, sellerId: null, status: ReviewStatus.APPROVED },
        })),
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
    categories: categories.length,
    catalogItems: catalogItems.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
