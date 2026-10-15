import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { CartService } from '../cart/cart.service';
import type { CartResponse } from '../cart/cart.service';
import { AddCartItemDto, UpdateCartItemDto } from '../cart/dto/cart.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqLocale } from '../common/decorators/locale.decorator';
import {
  ApiVer,
  MOBILE_API_VERSIONS,
} from '../common/decorators/api-version.decorator';
import type { ApiVersion } from '../common/decorators/api-version.decorator';
import { toLegacyListing } from '../listings/mobile-listing';

// v1: в листинге корзины `category` — род (см. toLegacyListing).
const toLegacyCart = (cart: CartResponse) => ({
  ...cart,
  items: cart.items.map((i) => ({ ...i, listing: toLegacyListing(i.listing) })),
});

const forVersion = (ver: ApiVersion) => (cart: CartResponse) =>
  ver === 2 ? cart : toLegacyCart(cart);

// Корзина мобилки: целиком под JWT — гостевой корзины нет.
@ApiTags('mobile/cart')
@ApiBearerAuth()
@Controller({ path: 'mobile/cart', version: MOBILE_API_VERSIONS })
@UseGuards(JwtAuthGuard)
export class MobileCartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Корзина текущего пользователя' })
  getCart(
    @CurrentUser('id') userId: string,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    return this.cart.getCart(userId, locale).then(forVersion(ver));
  }

  @Post('items')
  @ApiOperation({
    summary: 'Добавить листинг в корзину (или увеличить количество)',
  })
  addItem(
    @CurrentUser('id') userId: string,
    @Body() dto: AddCartItemDto,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    return this.cart.addItem(userId, dto, locale).then(forVersion(ver));
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Изменить количество позиции' })
  updateItem(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    return this.cart
      .updateQuantity(userId, id, dto, locale)
      .then(forVersion(ver));
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Удалить позицию из корзины' })
  removeItem(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    return this.cart.removeItem(userId, id, locale).then(forVersion(ver));
  }

  @Delete()
  @ApiOperation({ summary: 'Очистить корзину' })
  clearCart(
    @CurrentUser('id') userId: string,
    @ReqLocale() locale: Locale,
    @ApiVer() ver: ApiVersion,
  ) {
    return this.cart.clearCart(userId, locale).then(forVersion(ver));
  }
}
