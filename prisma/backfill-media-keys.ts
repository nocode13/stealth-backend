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
  console.log('Префикс для срезки:', `${publicUrl}/`);

  let sellersUpdated = 0;
  let mediaUpdated = 0;
  let itemsUpdated = 0;

  const sellers = await prisma.seller.findMany({
    where: { bannerUrl: { not: null } },
  });
  for (const s of sellers) {
    const bannerUrl = stripKey(s.bannerUrl);
    if (bannerUrl !== s.bannerUrl) {
      await prisma.seller.update({ where: { id: s.id }, data: { bannerUrl } });
      sellersUpdated++;
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
      mediaUpdated++;
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
      itemsUpdated++;
    }
  }

  // Нашлось, но ни одна строка не совпала с префиксом — почти наверняка
  // S3_PUBLIC_URL в этом окружении не тот, с которым были загружены старые
  // файлы. Печатаем пример для сверки глазами, а не гадаем молча.
  if (sellersUpdated + mediaUpdated + itemsUpdated === 0) {
    const sample = media[0]?.url ?? sellers[0]?.bannerUrl ?? items[0]?.catalogItemImageUrl;
    if (sample) {
      console.warn(
        'Ни одна строка не изменилась — префикс не совпал ни с одним значением. Пример из БД:',
        sample,
      );
    }
  }

  console.log('Бэкфилл готов:', {
    sellersFound: sellers.length,
    sellersUpdated,
    mediaFound: media.length,
    mediaUpdated,
    orderItemsFound: items.length,
    orderItemsUpdated: itemsUpdated,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
