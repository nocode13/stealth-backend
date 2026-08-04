import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BotSessionPurpose, Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  TelegramLinkService,
  type BotLinkCreated,
} from '../telegram/telegram-link.service';
import type { AuthPrincipal } from '../common/decorators/current-user.decorator';
import {
  CreateSellerStaffDto,
  SellerStaffDto,
  UpdateSellerStaffDto,
} from './dto/seller-staff.dto';

/**
 * Команда продавца: несколько рабочих аккаунтов на одного `Seller`.
 *
 * Сотрудник — это обычный `User(role: SELLER, sellerId)`, то есть тот же скоуп,
 * по которому уже живут заказы, листинги и каталог. Владелец
 * (`Seller.ownerUserId`) — такой же участник команды, отличается только тем, что
 * его нельзя удалить: на нём висит сам продавец (`onDelete: Cascade`).
 *
 * Привязка Telegram сотруднику идёт инвайт-ссылкой (BotLinkSession), а не через
 * его собственный вход в админку: пароль сотруднику можно вообще не заводить.
 */
@Injectable()
export class SellerStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly links: TelegramLinkService,
  ) {}

  async list(user: AuthPrincipal, sellerId: string): Promise<SellerStaffDto[]> {
    const seller = await this.assertCanManage(user, sellerId);
    const staff = await this.prisma.user.findMany({
      where: { sellerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return staff.map((s) => this.toDto(s, seller.ownerUserId));
  }

  async create(
    user: AuthPrincipal,
    sellerId: string,
    dto: CreateSellerStaffDto,
  ): Promise<SellerStaffDto> {
    const seller = await this.assertCanManage(user, sellerId);
    try {
      const created = await this.users.create({
        ...dto,
        role: Role.SELLER,
        sellerId,
      });
      return this.toDto(created, seller.ownerUserId);
    } catch (e) {
      throw this.contactConflict(e);
    }
  }

  async update(
    user: AuthPrincipal,
    sellerId: string,
    staffId: string,
    dto: UpdateSellerStaffDto,
  ): Promise<SellerStaffDto> {
    const seller = await this.assertCanManage(user, sellerId);
    await this.assertMember(sellerId, staffId);
    try {
      const updated = await this.prisma.user.update({
        where: { id: staffId },
        data: {
          name: dto.name,
          phone: dto.phone,
          email: dto.email,
          // Пароль меняем, только если его прислали: пустой пароль — не «сбросить».
          passwordHash: dto.password
            ? await bcrypt.hash(dto.password, 10)
            : undefined,
        },
      });
      return this.toDto(updated, seller.ownerUserId);
    } catch (e) {
      throw this.contactConflict(e);
    }
  }

  async remove(
    user: AuthPrincipal,
    sellerId: string,
    staffId: string,
  ): Promise<void> {
    const seller = await this.assertCanManage(user, sellerId);
    await this.assertMember(sellerId, staffId);
    if (staffId === seller.ownerUserId) {
      throw new BadRequestException('Владелец продавца не удаляется');
    }
    try {
      await this.prisma.user.delete({ where: { id: staffId } });
    } catch (e) {
      // На сотруднике висят строки, которые нельзя осиротить (например, заказы,
      // если он же оформлял их как покупатель со своей учётки).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'У сотрудника есть связанные данные — удалить нельзя',
        );
      }
      throw e;
    }
  }

  /** Ссылка/QR «открой бота продавца и привяжись» для конкретного сотрудника. */
  async invite(
    user: AuthPrincipal,
    sellerId: string,
    staffId: string,
  ): Promise<BotLinkCreated> {
    await this.assertCanManage(user, sellerId);
    await this.assertMember(sellerId, staffId);
    return this.links.createSession(staffId, BotSessionPurpose.SELLER_LINK);
  }

  /** Отвязка: уведомления молча перестают уходить, привязаться можно заново. */
  async unlink(
    user: AuthPrincipal,
    sellerId: string,
    staffId: string,
  ): Promise<SellerStaffDto> {
    const seller = await this.assertCanManage(user, sellerId);
    await this.assertMember(sellerId, staffId);
    await this.links.unlinkSeller(staffId);
    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: staffId },
    });
    return this.toDto(updated, seller.ownerUserId);
  }

  /**
   * Составом команды рулят SUPER_ADMIN (любым продавцом) и владелец — своим.
   * Рядовой сотрудник продавца сюда не допускается: иначе он завёл бы себе
   * коллегу с доступом ко всем заказам магазина.
   */
  private async assertCanManage(
    user: AuthPrincipal,
    sellerId: string,
  ): Promise<{ ownerUserId: string }> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { ownerUserId: true },
    });
    if (!seller) throw new NotFoundException('Продавец не найден');

    if (user.role === Role.SUPER_ADMIN) return seller;
    if (user.sellerId === sellerId && seller.ownerUserId === user.id) {
      return seller;
    }
    throw new ForbiddenException('Нет доступа к команде этого продавца');
  }

  /** Защита от попытки утащить чужого пользователя в свою команду. */
  private async assertMember(sellerId: string, staffId: string): Promise<void> {
    const member = await this.prisma.user.findFirst({
      where: { id: staffId, sellerId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Сотрудник не найден');
  }

  private toDto(user: User, ownerUserId: string): SellerStaffDto {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      telegramLinked: user.staffTelegramId !== null,
      isOwner: user.id === ownerUserId,
      hasPassword: user.passwordHash !== null,
      createdAt: user.createdAt,
    };
  }

  // Текст тот же, что у создания продавца, — ограничения на phone/email общие.
  private contactConflict(e: unknown): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const target = (e.meta?.target as string[] | undefined) ?? [];
      const field = target.includes('phone')
        ? 'Этот телефон'
        : target.includes('email')
          ? 'Этот email'
          : 'Эти данные';
      return new ConflictException(`${field} уже привязан к другому аккаунту`);
    }
    return e;
  }
}
