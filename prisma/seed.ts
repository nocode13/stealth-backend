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

  // Тестовый покупатель — для ручного тестирования мобилки (корзина и т.п.).
  const customer = await prisma.user.upsert({
    where: { email: 'customer@stealth.local' },
    update: {},
    create: {
      phone: '+998900000003',
      email: 'customer@stealth.local',
      passwordHash,
      role: Role.CUSTOMER,
    },
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

  // Тестовые позиции с реальными фото — для ручного тестирования витрины мобилки.
  const catalogWithPhotosSeed = [
    {
      name: 'Букет красных роз',
      slug: 'red-rose-bouquet-demo',
      categoryId: roses.id,
      description: 'Классический букет из 15 красных роз.',
      imageUrl:
        'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=800',
      unit: 'букет',
      price: 120000,
      stock: 25,
    },
    {
      name: 'Букет тюльпанов',
      slug: 'tulip-bouquet-demo',
      categoryId: tulips.id,
      description: 'Весенний букет из разноцветных тюльпанов.',
      imageUrl:
        'https://images.unsplash.com/photo-1520763185298-1b434c919102?w=800',
      unit: 'букет',
      price: 85000,
      stock: 40,
    },
    {
      name: 'Букет пионов',
      slug: 'peony-bouquet-demo',
      categoryId: peonies.id,
      description: 'Нежный букет из свежих пионов.',
      imageUrl:
        'https://images.unsplash.com/photo-1587321419931-8f2601b6c1e5?w=800',
      unit: 'букет',
      price: 150000,
      stock: 15,
    },
    {
      name: 'Одиночная роза',
      slug: 'single-rose-demo',
      categoryId: roses.id,
      description: 'Одна роза на длинном стебле, для точечного подарка.',
      imageUrl:
        'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=800',
      unit: 'шт',
      price: 15000,
      stock: 60,
    },
    {
      name: 'Букет белых роз',
      slug: 'white-rose-bouquet-demo',
      categoryId: roses.id,
      description: 'Букет из 11 белых роз.',
      imageUrl:
        'https://images.unsplash.com/photo-1487070183336-b863922373d4?w=800',
      unit: 'букет',
      price: 110000,
      stock: 20,
    },
    {
      name: 'Микс тюльпанов',
      slug: 'tulip-mix-demo',
      categoryId: tulips.id,
      description: 'Разноцветный микс тюльпанов, 21 шт.',
      imageUrl:
        'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800',
      unit: 'букет',
      price: 95000,
      stock: 30,
    },
    {
      name: 'Пионовидный букет',
      slug: 'peony-mix-demo',
      categoryId: peonies.id,
      description: 'Пышный букет из розовых и белых пионов.',
      imageUrl:
        'https://images.unsplash.com/photo-1509587584298-0f3b3a3a1797?w=800',
      unit: 'букет',
      price: 170000,
      stock: 10,
    },
    {
      name: 'Букет пионов premium',
      slug: 'peony-premium-demo',
      categoryId: peonies.id,
      description: 'Премиальный букет из крупных пионов.',
      imageUrl:
        'https://images.unsplash.com/photo-1591886960571-74d43a9d4166?w=800',
      unit: 'букет',
      price: 210000,
      stock: 8,
    },
    {
      name: 'Букет хризантем',
      slug: 'chrysanthemum-bouquet-demo',
      categoryId: chrysanthemums.id,
      description: 'Осенний букет из ярких хризантем.',
      imageUrl:
        'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=800',
      unit: 'букет',
      price: 75000,
      stock: 35,
    },
    {
      name: 'Хризантемы в корзине',
      slug: 'chrysanthemum-basket-demo',
      categoryId: chrysanthemums.id,
      description: 'Композиция из хризантем в плетёной корзине.',
      imageUrl:
        'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=800',
      unit: 'композиция',
      price: 135000,
      stock: 12,
    },
  ];

  for (const item of catalogWithPhotosSeed) {
    const existing = await prisma.catalogItem.findFirst({
      where: { slug: item.slug, sellerId: null },
    });
    const catalogItem =
      existing ??
      (await prisma.catalogItem.create({
        data: {
          name: item.name,
          slug: item.slug,
          categoryId: item.categoryId,
          description: item.description,
          imageUrl: item.imageUrl,
          unit: item.unit,
          sellerId: null,
          status: ReviewStatus.APPROVED,
        },
      }));

    await prisma.listing.upsert({
      where: {
        sellerId_catalogItemId: {
          sellerId: seller.id,
          catalogItemId: catalogItem.id,
        },
      },
      update: {},
      create: {
        sellerId: seller.id,
        catalogItemId: catalogItem.id,
        price: item.price,
        stock: item.stock,
        status: ListingStatus.ACTIVE,
      },
    });
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
    customer: customer.email,
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
