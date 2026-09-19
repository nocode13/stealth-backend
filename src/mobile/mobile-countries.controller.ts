import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { CountriesService } from '../countries/countries.service';
import { FindCountriesQueryDto } from '../countries/dto/country.dto';
import { ReqLocale } from '../common/decorators/locale.decorator';

// Список стран для витрины. Публичный эндпоинт — доступен без авторизации.
@ApiTags('mobile/countries')
@Controller('mobile/countries')
export class MobileCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  @ApiOperation({ summary: 'Страны (витрина)' })
  findAll(@Query() query: FindCountriesQueryDto, @ReqLocale() locale: Locale) {
    return this.countries.findStorefront(query, locale);
  }
}
