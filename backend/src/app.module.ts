import { Module } from '@nestjs/common';
import { CoreController } from './core/core.controller.js';
import { Db } from './db/db.service.js';

@Module({
  imports: [],
  controllers: [CoreController],
  providers: [Db],
})
export class AppModule {}
