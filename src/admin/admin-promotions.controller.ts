import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { PromotionsService } from '../promotions/promotions.service';
import {
  CreatePromotionDto,
  FindPromotionsQueryDto,
  UpdatePromotionDto,
} from '../promotions/dto/promotion.dto';

// Акции для покупателя: скидку оплачивает маржа платформы, поэтому заводит их только
// SUPER_ADMIN. Продавец акций не видит — его выплата от них не зависит.
@ApiTags('admin/promotions')
@ApiCookieAuth()
@Controller('admin/promotions')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  findAll(@Query() query: FindPromotionsQueryDto) {
    return this.promotions.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Акция с составом (листинги и их текущие цены)' })
  findOne(@Param('id') id: string) {
    return this.promotions.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать акцию — цены её листингов пересчитываются сразу',
  })
  create(@Body() dto: CreatePromotionDto) {
    return this.promotions.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Изменить акцию; items, если передан, заменяет состав целиком',
  })
  update(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.promotions.remove(id);
  }
}
