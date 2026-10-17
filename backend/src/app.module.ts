import { Module } from '@nestjs/common';
import { CoreController } from './core/core.controller.js';
import { Db } from './db/db.service.js';
import { MobileController } from './mobile/mobile.controller.js';
import { FixturesController } from './fixtures/fixtures.controller.js';
import { DomainEvents } from './queue/domain-events.js';
import { AuthService } from './rbac/auth.service.js';
import { RbacController } from './rbac/rbac.controller.js';
import { RosterController } from './roster/roster.controller.js';
import { RosterService } from './roster/roster.service.js';
import { EventsController } from './scoring/events.controller.js';
import { EventsService } from './scoring/events.service.js';
import { SportsController } from './sports/sports.controller.js';
import { LeaguesController } from './standings/leagues.controller.js';
import { StoreController } from './store/store.controller.js';
import { StoreService } from './store/store.service.js';
import { OfflineSyncController } from './sync/offline-sync.controller.js';
import { OfflineSyncService } from './sync/offline-sync.service.js';

@Module({
  imports: [],
  controllers: [
    CoreController, SportsController, EventsController, LeaguesController, StoreController, RbacController,
    RosterController, OfflineSyncController, FixturesController, MobileController,
  ],
  providers: [LeaguesController, Db, EventsService, StoreService, DomainEvents, AuthService, RosterService, OfflineSyncService],
})
export class AppModule {}
