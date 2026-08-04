import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { SellerStaffService } from '../sellers/seller-staff.service';
import {
  CreateSellerStaffDto,
  UpdateSellerStaffDto,
} from '../sellers/dto/seller-staff.dto';

/**
 * Команда продавца. Отдельный контроллер от AdminSellersController: там на классе
 * висит @Roles(SUPER_ADMIN), а сюда пускаем ещё и владельца — свою команду он
 * собирает сам. Кто именно допущен, решает SellerStaffService.assertCanManage:
 * роли тут мало, нужна проверка владения конкретным продавцом.
 */
@ApiTags('admin/sellers')
@ApiCookieAuth()
@Controller('admin/sellers/:sellerId/staff')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SELLER, Role.SUPER_ADMIN)
export class AdminSellerStaffController {
  constructor(private readonly staff: SellerStaffService) {}

  @Get()
  @ApiOperation({ summary: 'Сотрудники продавца' })
  findAll(@CurrentUser() user: AuthUser, @Param('sellerId') sellerId: string) {
    return this.staff.list(user, sellerId);
  }

  @Post()
  @ApiOperation({ summary: 'Добавить сотрудника в команду продавца' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('sellerId') sellerId: string,
    @Body() dto: CreateSellerStaffDto,
  ) {
    return this.staff.create(user, sellerId, dto);
  }

  @Patch(':staffId')
  @ApiOperation({ summary: 'Изменить контакты или пароль сотрудника' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('sellerId') sellerId: string,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateSellerStaffDto,
  ) {
    return this.staff.update(user, sellerId, staffId, dto);
  }

  @Delete(':staffId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить сотрудника (владельца нельзя)' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('sellerId') sellerId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staff.remove(user, sellerId, staffId);
  }

  @Post(':staffId/telegram/invite')
  @ApiOperation({
    summary: 'Ссылка/QR для привязки Telegram сотрудника к боту продавца',
  })
  invite(
    @CurrentUser() user: AuthUser,
    @Param('sellerId') sellerId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staff.invite(user, sellerId, staffId);
  }

  @Post(':staffId/telegram/unlink')
  @ApiOperation({ summary: 'Отвязать Telegram сотрудника' })
  unlink(
    @CurrentUser() user: AuthUser,
    @Param('sellerId') sellerId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staff.unlink(user, sellerId, staffId);
  }
}
