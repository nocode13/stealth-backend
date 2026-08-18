import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Та же логика, что была в StorageService.keyFromUrl() и остаётся в configuration.ts:
// хвостовой слэш срезаем, чтобы не разъехаться на двойном слэше.
const publicUrl = process.env.S3_PUBLIC_URL?.replace(/\/+$/, '');

function stripKey<T extends string | null>(url: T): T {
  if (!publicUrl || !url) return url;
  const prefix = `${publicUrl}/`;
  return (url.startsWith(prefix) ? url.slice(prefix.length) : url) as T;
}

async function main() {
  if (!publicUrl) throw new Error('S3_PUBLIC_URL не задан в env');

  const sellers = await prisma.seller.findMany({
    where: { bannerUrl: { not: null } },
  });
  for (const s of sellers) {
    const bannerUrl = stripKey(s.bannerUrl);
    if (bannerUrl !== s.bannerUrl) {
      await prisma.seller.update({ where: { id: s.id }, data: { bannerUrl } });
    }
  }

  const media = await prisma.catalogItemMedia.findMany();
  for (const m of media) {
    const url = stripKey(m.url);
    const posterUrl = stripKey(m.posterUrl);
    if (url !== m.url || posterUrl !== m.posterUrl) {
      await prisma.catalogItemMedia.update({
        where: { id: m.id },
        data: { url, posterUrl },
      });
    }
  }

  const items = await prisma.orderItem.findMany({
    where: { catalogItemImageUrl: { not: null } },
  });
  for (const i of items) {
    const catalogItemImageUrl = stripKey(i.catalogItemImageUrl);
    if (catalogItemImageUrl !== i.catalogItemImageUrl) {
      await prisma.orderItem.update({
        where: { id: i.id },
        data: { catalogItemImageUrl },
      });
    }
  }

  console.log('Бэкфилл готов:', {
    sellers: sellers.length,
    media: media.length,
    orderItems: items.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
