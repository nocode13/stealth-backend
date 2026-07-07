import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ListingsService } from '../listings/listings.service';
import {
  CreateListingDto,
  UpdateListingDto,
} from '../listings/dto/listing.dto';

// Управление листингами продавца. Продавец работает только со своими.
@ApiTags('admin/listings')
@ApiCookieAuth()
@Controller('admin/listings')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SELLER, Role.SUPER_ADMIN)
export class AdminListingsController {
  constructor(private readonly listings: ListingsService) {}

  // sellerId берётся из привязки пользователя.
  private sellerId(user: AuthUser): string {
    if (!user.sellerId) {
      throw new ForbiddenException('Пользователь не привязан к продавцу');
    }
    return user.sellerId;
  }

  @Get()
  @ApiOperation({ summary: 'Мои листинги' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.listings.findForSeller(this.sellerId(user));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.findOneForSeller(id, this.sellerId(user));
  }

  @Post()
  @ApiOperation({ summary: 'Создать листинг по позиции справочника' })
  create(@Body() dto: CreateListingDto, @CurrentUser() user: AuthUser) {
    return this.listings.create(this.sellerId(user), dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.listings.update(id, this.sellerId(user), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.remove(id, this.sellerId(user));
  }
}
