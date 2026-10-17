import { Body, Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { Post } from '@nestjs/common';
import type { Response } from 'express';
import { Db } from '../db/db.service.js';
import { AuthService } from '../rbac/auth.service.js';
import { RosterLeague, squadOn } from '../roster/roster.service.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';
import type { SportConfig } from '../sports/sport-config.js';
import { LeaguesController } from '../standings/leagues.controller.js';
import { StoreService } from '../store/store.service.js';
import { today } from '../common/validate.js';

// Read models for the mobile app. One bootstrap call returns everything the app caches for offline use.
@Controller('api/v1')
export class MobileController {
  constructor(
    private readonly db: Db, private readonly auth: AuthService, private readonly events: EventsService,
    private readonly leagues: LeaguesController, private readonly store: StoreService,
  ) {}

  @Get('bootstrap')
  async bootstrap(@Headers('authorization') authz: string) {
    const me = this.auth.verify(authz);
    const tenantId = me.tenant_id ?? 'tenant-alpha';
    const tenant = await this.db.get('tenant', tenantId);
    const clubs = (await this.db.list('club')).filter((c) => c.tenant_id === tenantId);
    const leagues = (await this.db.list('league')).filter((l) => l.tenant_id === tenantId);
    const roster = await this.db.get<RosterLeague>('roster_league', 'demo-roster');
    const date = today();

    const fixtures = [];
    for (const l of leagues) {
      for (const f of l.fixtures) fixtures.push(await this.matchSummary(f.match_id));
    }
    const standings = [];
    for (const l of leagues) standings.push({ ...(await this.leagues.standings(l.league_id)), name: l.name, season: l.season });

    const clubProfiles = clubs.map((c) => ({
      ...c,
      roster: roster ? Object.values(roster.players).filter((p) => squadOn(p.reg, date) === c.club_id)
        .map((p) => ({ player_id: p.player_id, name: p.name, position: p.position, role: p.reg.role, on_loan: p.reg.registration_type === 'loan' })) : [],
    }));

    const products = (await this.db.list('product')).filter((p) => p.tenant_id === tenantId);
    for (const p of products)
      for (const v of p.variants) v.stock = (await this.db.query('SELECT stock FROM inventory WHERE variant_id=$1', [v.variant_id])).rows[0]?.stock ?? 0;

    return {
      me, tenant, leagues: leagues.map((l) => ({ league_id: l.league_id, name: l.name, season: l.season, sport_id: l.sport_id })),
      fixtures, standings, clubs: clubProfiles, products, roster_league_id: 'demo-roster', fetched_at: new Date().toISOString(),
    };
  }

  private async matchSummary(matchId: string) {
    const m = await this.events.loadMatch(this.db.pool, matchId);
    if (!m) return null;
    const p = project(m.sport as SportConfig, m.match, m.events);
    const mm: any = m.match;
    return {
      match_id: matchId, league_id: mm.league_id, kickoff: mm.kickoff ?? null, venue: mm.venue ?? null,
      home: mm.home_team_id, away: mm.away_team_id, status: p.status, home_score: p.home.score, away_score: p.away.score,
      version: p.version,
    };
  }

  @Get('matches/:id')
  async match(@Headers('authorization') authz: string, @Param('id') id: string) {
    this.auth.verify(authz);
    const score = await this.events.score(id);
    const m: any = await this.db.get('match', id);
    const product = m?.pinned_product_id ? await this.db.get('product', m.pinned_product_id) : null;
    return { ...score, kickoff: m?.kickoff ?? null, venue: m?.venue ?? null, pinned_product: product };
  }

  @Post('checkout')
  async checkout(@Headers('authorization') authz: string, @Body() body: any, @Res() res: Response) {
    this.auth.verify(authz);
    const r = await this.store.checkout(body);
    res.status(r.status).json(r.body);
  }
}
