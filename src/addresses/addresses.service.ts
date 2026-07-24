import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SavedAddress } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<SavedAddress[]> {
    return this.prisma.savedAddress.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(userId: string, dto: CreateAddressDto): Promise<SavedAddress> {
    return this.prisma.savedAddress.create({ data: { userId, ...dto } });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<SavedAddress> {
    await this.findOwned(userId, id);
    return this.prisma.savedAddress.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string): Promise<SavedAddress> {
    await this.findOwned(userId, id);
    return this.prisma.savedAddress.delete({ where: { id } });
  }

  // Переиспользуется OrdersService для проверки владения savedAddressId при оформлении заказа.
  async findOwned(userId: string, id: string): Promise<SavedAddress> {
    const address = await this.prisma.savedAddress.findUnique({
      where: { id },
    });
    if (!address) throw new NotFoundException('Адрес не найден');
    if (address.userId !== userId) {
      throw new ForbiddenException('Чужой адрес');
    }
    return address;
  }
}
