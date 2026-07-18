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
import { CartService } from '../cart/cart.service';
import { AddCartItemDto, UpdateCartItemDto } from '../cart/dto/cart.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Корзина мобилки: целиком под JWT — гостевой корзины нет.
@ApiTags('mobile/cart')
@ApiBearerAuth()
@Controller('mobile/cart')
@UseGuards(JwtAuthGuard)
export class MobileCartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Корзина текущего пользователя' })
  getCart(@CurrentUser('id') userId: string) {
    return this.cart.getCart(userId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Добавить листинг в корзину (или увеличить количество)' })
  addItem(@CurrentUser('id') userId: string, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(userId, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Изменить количество позиции' })
  updateItem(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateQuantity(userId, id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Удалить позицию из корзины' })
  removeItem(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.cart.removeItem(userId, id);
  }

  @Delete()
  @ApiOperation({ summary: 'Очистить корзину' })
  clearCart(@CurrentUser('id') userId: string) {
    return this.cart.clearCart(userId);
  }
}
