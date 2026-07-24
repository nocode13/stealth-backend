import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service';

@Module({
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
