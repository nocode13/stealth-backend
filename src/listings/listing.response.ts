import { Locale, ListingStatus, Prisma } from '@prisma/client';
import { pickTranslation } from '../i18n/pick';
import {
  CatalogItemResponse,
  toCatalogItemResponse,
} from '../catalog/catalog.response';

export type ListingWithTranslations = Prisma.ListingGetPayload<{
  include: {
    catalogItem: {
      include: {
        translations: true;
        category: { include: { translations: true } };
        media: true;
      };
    };
    seller: { select: { id: true; translations: true } };
  };
}>;

export interface ListingResponse {
  id: string;
  sellerId: string;
  seller: { id: string; name: string };
  catalogItemId: string;
  catalogItem: CatalogItemResponse;
  price: number;
  stock: number;
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const toListingResponse = (
  l: ListingWithTranslations,
  locale: Locale,
): ListingResponse => ({
  id: l.id,
  sellerId: l.sellerId,
  seller: {
    id: l.seller.id,
    name: pickTranslation(l.seller.translations, locale).name,
  },
  catalogItemId: l.catalogItemId,
  catalogItem: toCatalogItemResponse(l.catalogItem, locale),
  price: l.price,
  stock: l.stock,
  status: l.status,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});
