import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddressesService } from '../addresses/addresses.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
} from '../addresses/dto/address.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MOBILE_API_VERSIONS } from '../common/decorators/api-version.decorator';

// Адресная книга мобилки: целиком под JWT — гостевой адресной книги нет.
@ApiTags('mobile/addresses')
@ApiBearerAuth()
@Controller({ path: 'mobile/addresses', version: MOBILE_API_VERSIONS })
@UseGuards(JwtAuthGuard)
export class MobileAddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'Сохранённые адреса текущего пользователя' })
  list(@CurrentUser('id') userId: string) {
    return this.addresses.list(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Сохранить новый адрес' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAddressDto) {
    return this.addresses.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить сохранённый адрес' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить сохранённый адрес' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.addresses.remove(userId, id);
  }
}
