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
import { CountriesService } from '../countries/countries.service';
import {
  CreateCountryDto,
  FindCountriesQueryDto,
  UpdateCountryDto,
} from '../countries/dto/country.dto';

// Страны: платформенный справочник, только SUPER_ADMIN — продавец не предлагает
// свои, только выбирает из готового списка.
@ApiTags('admin/countries')
@ApiCookieAuth()
@Controller('admin/countries')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  findAll(@Query() query: FindCountriesQueryDto) {
    return this.countries.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.countries.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCountryDto) {
    return this.countries.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCountryDto) {
    return this.countries.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить страну — 409, если к ней привязаны позиции каталога',
  })
  remove(@Param('id') id: string) {
    return this.countries.remove(id);
  }
}
