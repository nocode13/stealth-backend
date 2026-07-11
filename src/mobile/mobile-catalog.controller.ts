import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from '../catalog/catalog.service';
import { FindCatalogQueryDto } from '../catalog/dto/catalog.dto';

// Просмотр справочника из мобилки (защищено JWT).
@ApiTags('mobile/catalog')
@ApiBearerAuth()
@Controller('mobile/catalog')
@UseGuards(JwtAuthGuard)
export class MobileCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Справочник цветов' })
  findAll(@Query() query: FindCatalogQueryDto) {
    return this.catalog.findAll(query);
  }
}
