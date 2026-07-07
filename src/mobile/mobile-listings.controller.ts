import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListingsService } from '../listings/listings.service';

// Витрина мобилки: активные листинги с остатком.
@ApiTags('mobile/listings')
@ApiBearerAuth()
@Controller('mobile/listings')
@UseGuards(JwtAuthGuard)
export class MobileListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Активные предложения (витрина)' })
  findAll(@Query('search') search?: string) {
    return this.listings.findStorefront(search);
  }
}
