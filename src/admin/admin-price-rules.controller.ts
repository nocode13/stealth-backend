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
import { PriceRulesService } from '../pricing/price-rules.service';
import {
  CreatePriceRuleDto,
  FindPriceRulesQueryDto,
  UpdatePriceRuleDto,
} from '../pricing/dto/price-rule.dto';

// Скрытые правила цены (наценка/скидка/фикс по области). Покупатель их не видит —
// видимая скидка это admin/promotions. Только SUPER_ADMIN: продавец наценку не знает.
@ApiTags('admin/price-rules')
@ApiCookieAuth()
@Controller('admin/price-rules')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPriceRulesController {
  constructor(private readonly rules: PriceRulesService) {}

  @Get()
  findAll(@Query() query: FindPriceRulesQueryDto) {
    return this.rules.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rules.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать правило — витрина в его области пересчитывается сразу',
  })
  create(@Body() dto: CreatePriceRuleDto) {
    return this.rules.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePriceRuleDto) {
    return this.rules.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }
}
