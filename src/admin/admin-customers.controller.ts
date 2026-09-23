import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from '../users/users.service';
import { FindCustomersQueryDto } from '../users/dto/customer.dto';

@ApiTags('admin/customers')
@ApiCookieAuth()
@Controller('admin/customers')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminCustomersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Покупатели (поиск для выбора получателей рассылки)',
  })
  findAll(@Query() query: FindCustomersQueryDto) {
    return this.users.findCustomers(query);
  }
}
