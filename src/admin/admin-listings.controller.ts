import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  FindListingsQueryDto,
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

  // SUPER_ADMIN к продавцу не привязан и работает без скоупа (null); продавец —
  // только со своими листингами.
  private scope(user: AuthUser): string | null {
    return user.role === Role.SUPER_ADMIN ? null : this.sellerId(user);
  }

  @Get()
  @ApiOperation({
    summary:
      'Мои листинги (SUPER_ADMIN видит все, ?sellerId= сужает до одного)',
  })
  findAll(@Query() query: FindListingsQueryDto, @CurrentUser() user: AuthUser) {
    const sellerId =
      user.role === Role.SUPER_ADMIN
        ? (query.sellerId ?? null)
        : this.sellerId(user);
    return this.listings.findForSeller(sellerId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.findOneForSeller(id, this.scope(user));
  }

  @Post()
  @ApiOperation({
    summary:
      'Создать листинг по позиции справочника (SUPER_ADMIN указывает sellerId)',
  })
  create(@Body() dto: CreateListingDto, @CurrentUser() user: AuthUser) {
    if (user.role === Role.SUPER_ADMIN) {
      if (!dto.sellerId) throw new BadRequestException('Не выбран продавец');
      return this.listings.create(dto.sellerId, dto);
    }
    return this.listings.create(this.sellerId(user), dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.listings.update(id, this.scope(user), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.remove(id, this.scope(user));
  }
}
