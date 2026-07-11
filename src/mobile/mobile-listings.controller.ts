import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListingsService } from '../listings/listings.service';
import { FindListingsQueryDto } from '../listings/dto/listing.dto';

// Витрина мобилки: активные листинги с остатком.
@ApiTags('mobile/listings')
@ApiBearerAuth()
@Controller('mobile/listings')
@UseGuards(JwtAuthGuard)
export class MobileListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Активные предложения (витрина)' })
  findAll(@Query() query: FindListingsQueryDto) {
    return this.listings.findStorefront(query);
  }
}
