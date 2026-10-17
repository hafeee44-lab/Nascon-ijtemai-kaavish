import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { conflict, notFound, validationError } from '../common/api-error.js';
import { isId, isInt, isObj } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { lastSeed } from '../db/seed.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';
import { SportConfig, TIE_BREAKS } from '../sports/sport-config.js';
import { computeStandings, League, PlayedMatch } from './standings.js';

@Controller('audit/v1')
export class LeaguesController {
  constructor(private readonly db: Db, private readonly events: EventsService) {}

  // Spec 5.8: register teams + fixtures; every fixture becomes an upcoming match stream.
  @Post('leagues')
  @HttpCode(201)
  async create(@Body() b: any) {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!isId(b.league_id)) bad.push('league_id');
    if (!isId(b.sport_id)) bad.push('sport_id');
    const teams = b.teams;
    if (!Array.isArray(teams) || teams.length < 2 || teams.length > 40 || !teams.every(isId) || new Set(teams).size !== teams.length) bad.push('teams');
    const fx = b.fixtures;
    if (!Array.isArray(fx) || !fx.every((f: any) => isObj(f) && isId(f.match_id) && isId(f.home) && isId(f.away) && f.home !== f.away &&
      Array.isArray(teams) && teams.includes(f.home) && teams.includes(f.away)))
      bad.push('fixtures');
    const pts = b.points ?? {};
    if (!isObj(pts) || !['win', 'draw', 'loss'].every((k) => pts[k] === undefined || isInt(pts[k]))) bad.push('points');
    if (b.tie_break_order !== undefined && (!Array.isArray(b.tie_break_order) || !b.tie_break_order.every((x: any) => TIE_BREAKS.includes(x)) ||
      new Set(b.tie_break_order).size !== b.tie_break_order.length))
      bad.push('tie_break_order');
    const spots = b.qualification?.spots;
    if (!isObj(b.qualification) || !isInt(spots) || spots < 1 || !Array.isArray(teams) || spots > teams.length) bad.push('qualification');
    if (b.lots_seed !== undefined && !isInt(b.lots_seed)) bad.push('lots_seed');
    if (bad.length) throw validationError(bad);

    const league: League = {
      league_id: b.league_id, sport_id: b.sport_id, teams, fixtures: fx.map((f: any) => ({ match_id: f.match_id, home: f.home, away: f.away })),
      points: { win: pts.win ?? 3, draw: pts.draw ?? 1, loss: pts.loss ?? 0 },
      tie_break_order: b.tie_break_order ?? null, qualification: { spots }, lots_seed: b.lots_seed ?? (await lastSeed(this.db)),
    };

    await this.db.tx(async (c) => {
      if (!(await this.db.get('sport', league.sport_id, c))) throw notFound('SPORT_NOT_FOUND', `Sport ${league.sport_id} does not exist.`, { sport_id: league.sport_id });
      const ins = await c.query(`INSERT INTO docs(kind,id,data) VALUES('league',$1,$2) ON CONFLICT DO NOTHING RETURNING id`, [league.league_id, JSON.stringify(league)]);
      if (!ins.rowCount) throw conflict('LEAGUE_EXISTS', `League ${league.league_id} already exists.`, { league_id: league.league_id });
      const seen = new Set<string>();
      for (const f of league.fixtures) {
        const match = { match_id: f.match_id, sport_id: league.sport_id, league_id: league.league_id, home_team_id: f.home, away_team_id: f.away };
        const r = seen.has(f.match_id) ? { rowCount: 0 }
          : await c.query(`INSERT INTO docs(kind,id,data) VALUES('match',$1,$2) ON CONFLICT DO NOTHING RETURNING id`, [f.match_id, JSON.stringify(match)]);
        if (!r.rowCount) throw conflict('MATCH_EXISTS', `Match ${f.match_id} already exists.`, { match_id: f.match_id });
        seen.add(f.match_id);
      }
    });
    return { league_id: league.league_id, status: 'created', team_count: league.teams.length, fixture_count: league.fixtures.length };
  }

  // Spec 5.10: recomputed from the event logs on every call.
  @Get('standings/:leagueId')
  async standings(@Param('leagueId') leagueId: string) {
    const league = await this.db.get<League>('league', leagueId);
    if (!league) throw notFound('LEAGUE_NOT_FOUND', `League ${leagueId} does not exist.`, { league_id: leagueId });
    const sport = (await this.db.get<SportConfig>('sport', league.sport_id))!;
    const played: PlayedMatch[] = [];
    const remaining = new Map<string, number>(league.teams.map((t) => [t, 0]));
    for (const f of league.fixtures) {
      const m = await this.events.loadMatch(this.db.pool, f.match_id);
      const p = m ? project(sport, m.match, m.events) : null;
      if (p && p.status === 'completed' && p.outcome !== 'undecided') {
        played.push({
          home: f.home, away: f.away, homeScore: p.home.score, awayScore: p.away.score,
          winner: p.outcome === 'draw' ? null : p.winner_team_id,
          homeFairPlay: p.home.fair_play, awayFairPlay: p.away.fair_play,
          homeBalls: p.home.balls, awayBalls: p.away.balls, homeWickets: p.home.wickets, awayWickets: p.away.wickets,
        });
      } else {
        remaining.set(f.home, (remaining.get(f.home) ?? 0) + 1);
        remaining.set(f.away, (remaining.get(f.away) ?? 0) + 1);
      }
    }
    const { table, h2h } = computeStandings(sport, league, played, remaining);
    return { league_id: league.league_id, sport_id: league.sport_id, qualification_spots: league.qualification.spots, table, h2h };
  }
}
