import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, SellerStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SellersService } from '../sellers/sellers.service';

class UpdateSellerStatusDto {
  @IsEnum(SellerStatus)
  status: SellerStatus;
}

// Управление продавцами — только супер-админ (готовность к мультипродавцу).
@ApiTags('admin/sellers')
@ApiCookieAuth()
@Controller('admin/sellers')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSellersController {
  constructor(private readonly sellers: SellersService) {}

  @Get()
  @ApiOperation({ summary: 'Список продавцов' })
  findAll() {
    return this.sellers.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sellers.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Сменить статус продавца' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateSellerStatusDto) {
    return this.sellers.updateStatus(id, dto.status);
  }
}
