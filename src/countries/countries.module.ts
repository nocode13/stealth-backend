import { Module } from '@nestjs/common';
import { CountriesService } from './countries.service';

@Module({
  providers: [CountriesService],
  exports: [CountriesService],
})
export class CountriesModule {}
