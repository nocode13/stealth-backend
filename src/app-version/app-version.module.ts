import { Module } from '@nestjs/common';
import { AppVersionService } from './app-version.service';

@Module({
  providers: [AppVersionService],
  exports: [AppVersionService],
})
export class AppVersionModule {}
