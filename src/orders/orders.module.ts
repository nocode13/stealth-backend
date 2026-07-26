import { Module } from '@nestjs/common';
import { TelegramNotifyModule } from '../telegram/telegram-notify.module';
import { AddressesModule } from '../addresses/addresses.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderNotifier } from './order-notifier.service';
import { OrdersService } from './orders.service';

// Домейн-модуль: только сервисы, контроллеры живут в MobileModule/AdminModule.
// Зависит от TelegramNotifyModule (исходящие), но НЕ от TelegramModule (хендлеры) —
// иначе получился бы цикл, т.к. кабинет продавца в боте зовёт OrdersService.
// AddressesModule нужен для проверки владения savedAddressId при оформлении заказа.
// NotificationsModule — второй канал уведомления покупателя (in-app лента); цикла не
// создаёт, т.к. NotificationsService не знает ни о заказах, ни о Telegram.
@Module({
  imports: [TelegramNotifyModule, AddressesModule, NotificationsModule],
  providers: [OrdersService, OrderNotifier],
  exports: [OrdersService, OrderNotifier],
})
export class OrdersModule {}
