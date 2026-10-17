import { Module } from '@nestjs/common';
import { CoreController } from './core/core.controller.js';
import { Db } from './db/db.service.js';
import { EventsController } from './scoring/events.controller.js';
import { EventsService } from './scoring/events.service.js';
import { SportsController } from './sports/sports.controller.js';
import { LeaguesController } from './standings/leagues.controller.js';

@Module({
  imports: [],
  controllers: [CoreController, SportsController, EventsController, LeaguesController],
  providers: [Db, EventsService],
})
export class AppModule {}
