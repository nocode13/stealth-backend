import { Module } from '@nestjs/common';
import { TelegramNotifyModule } from '../telegram/telegram-notify.module';
import { AddressesModule } from '../addresses/addresses.module';
import { OrderNotifier } from './order-notifier.service';
import { OrdersService } from './orders.service';

// Домейн-модуль: только сервисы, контроллеры живут в MobileModule/AdminModule.
// Зависит от TelegramNotifyModule (исходящие), но НЕ от TelegramModule (хендлеры) —
// иначе получился бы цикл, т.к. кабинет продавца в боте зовёт OrdersService.
// AddressesModule нужен для проверки владения savedAddressId при оформлении заказа.
@Module({
  imports: [TelegramNotifyModule, AddressesModule],
  providers: [OrdersService, OrderNotifier],
  exports: [OrdersService, OrderNotifier],
})
export class OrdersModule {}
