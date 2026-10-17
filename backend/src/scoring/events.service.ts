import { Injectable } from '@nestjs/common';
import { ApiError, conflict, notFound, validationError } from '../common/api-error.js';
import { canonical, sign } from '../common/canonical.js';
import { isId, isInt, isObj, isStr } from '../common/validate.js';
import { Db, Tx } from '../db/db.service.js';
import type { SportConfig } from '../sports/sport-config.js';
import { MatchInfo, Projection, project, scoringLimit, StoredEvent } from './projection.js';

const TYPES = ['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation'];

export interface EventResult {
  status: 200 | 201;
  body: { event_id: string; match_id: string; type: string; sequence: number; match_version: number; signature: string };
}

@Injectable()
export class EventsService {
  constructor(private readonly db: Db) {}

  validate(b: any) {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!isId(b.event_id)) bad.push('event_id');
    if (!isId(b.match_id)) bad.push('match_id');
    if (!TYPES.includes(b.type)) bad.push('type');
    if (b.payload !== undefined && !isObj(b.payload)) bad.push('payload');
    if (bad.length) throw validationError(bad);
    const p = b.payload ?? {};
    const need = (cond: boolean, f: string) => cond || bad.push(`payload.${f}`);
    switch (b.type) {
      case 'match_init':
        need(isId(p.sport_id), 'sport_id');
        need(isId(p.home_team_id), 'home_team_id');
        need(isId(p.away_team_id), 'away_team_id');
        need(p.home_team_id !== p.away_team_id, 'away_team_id');
        need(p.league_id === undefined || p.league_id === null || isId(p.league_id), 'league_id');
        break;
      case 'score':
        need(isId(p.team_id), 'team_id');
        need(isStr(p.event_type), 'event_type');
        break;
      case 'discipline':
        need(isId(p.team_id), 'team_id');
        need(isInt(p.points), 'points');
        break;
      case 'tiebreak_winner':
        need(isId(p.team_id), 'team_id');
        break;
      case 'compensation':
        need(isId(p.compensates), 'compensates');
        need(p.reason === undefined || isStr(p.reason), 'reason');
        break;
    }
    if (bad.length) throw validationError(bad);
  }

  async loadMatch(c: Tx | Db['pool'], matchId: string) {
    const match = await this.db.get<MatchInfo>('match', matchId, c);
    if (!match) return null;
    const sport = await this.db.get<SportConfig>('sport', match.sport_id, c);
    const r = await c.query(
      'SELECT seq, event_id, type, payload, signature FROM match_events WHERE match_id=$1 ORDER BY seq',
      [matchId],
    );
    return { match, sport: sport!, events: r.rows as StoredEvent[] };
  }

  // Spec 5.9: append one event (or compensation) to a match's log.
  async append(b: any): Promise<EventResult> {
    this.validate(b);
    const request = { event_id: b.event_id, match_id: b.match_id, type: b.type, payload: b.payload ?? {} };
    const replay = await this.replay(request);
    if (replay) return replay;
    try {
      return await this.db.tx((c) => this.appendTx(c, request));
    } catch (e: any) {
      // Two identical requests raced: the loser sees the unique violation and replays.
      if (e?.code === '23505') {
        const again = await this.replay(request);
        if (again) return again;
      }
      throw e;
    }
  }

  private async replay(request: any): Promise<EventResult | null> {
    const r = await this.db.query('SELECT match_id, seq, type, signature, request FROM match_events WHERE event_id=$1', [request.event_id]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    if (canonical(row.request) !== canonical(request))
      throw conflict('DUPLICATE_EVENT_ID', `Event ${request.event_id} was already used with a different body.`, { event_id: request.event_id });
    return {
      status: 200,
      body: { event_id: request.event_id, match_id: row.match_id, type: row.type, sequence: row.seq, match_version: row.seq, signature: row.signature },
    };
  }

  async appendTx(c: Tx, request: any): Promise<EventResult> {
    const { match_id, type, payload } = request;
    if (type === 'match_init') {
      const sport = await this.db.get<SportConfig>('sport', payload.sport_id, c);
      if (!sport) throw notFound('SPORT_NOT_FOUND', `Sport ${payload.sport_id} does not exist.`, { sport_id: payload.sport_id });
      const match: MatchInfo = {
        match_id, sport_id: payload.sport_id, league_id: payload.league_id ?? null,
        home_team_id: payload.home_team_id, away_team_id: payload.away_team_id,
      };
      const ins = await c.query(`INSERT INTO docs(kind,id,data) VALUES('match',$1,$2) ON CONFLICT DO NOTHING RETURNING id`, [match_id, JSON.stringify(match)]);
      if (!ins.rowCount) throw conflict('MATCH_EXISTS', `Match ${match_id} already exists.`, { match_id });
      return this.insert(c, request, 1);
    }

    const locked = await this.db.getForUpdate<MatchInfo>(c, 'match', match_id);
    if (!locked) throw notFound('MATCH_NOT_FOUND', `Match ${match_id} does not exist.`, { match_id });
    const { match, sport, events } = (await this.loadMatch(c, match_id))!;
    const proj = project(sport, match, events);
    this.checkRules(sport, match, events, proj, type, payload);
    return this.insert(c, request, events.length + 1);
  }

  checkRules(sport: SportConfig, match: MatchInfo, events: StoredEvent[], proj: Projection, type: string, p: any) {
    const sides = [match.home_team_id, match.away_team_id];
    const notInProgress = () =>
      new ApiError(409, 'MATCH_NOT_IN_PROGRESS', `Match ${match.match_id} is not in progress.`, { match_id: match.match_id, status: proj.status });
    switch (type) {
      case 'match_start':
        if (proj.status !== 'upcoming')
          throw conflict('ILLEGAL_TRANSITION', `Cannot start a match that is ${proj.status}.`, { match_id: match.match_id, from: proj.status, to: 'in_progress' });
        return;
      case 'score':
        if (!sides.includes(p.team_id)) throw validationError(['payload.team_id'], 'team_id is not a side of this match.');
        if (!Object.prototype.hasOwnProperty.call(sport.scoring_events, p.event_type))
          throw new ApiError(400, 'UNKNOWN_EVENT_TYPE', `Event type ${p.event_type} is not defined for ${sport.sport_id}.`, { event_type: p.event_type });
        if (proj.status !== 'in_progress') throw notInProgress();
        {
          const limit = scoringLimit(sport, proj, p.team_id);
          if (limit) throw conflict(limit, 'No further scoring events are allowed for this team.', { match_id: match.match_id, team_id: p.team_id });
        }
        return;
      case 'discipline':
      case 'tiebreak_winner':
        if (!sides.includes(p.team_id)) throw validationError(['payload.team_id'], 'team_id is not a side of this match.');
        if (proj.status !== 'in_progress') throw notInProgress();
        return;
      case 'match_end':
        if (proj.status !== 'in_progress')
          throw conflict('ILLEGAL_TRANSITION', `Cannot end a match that is ${proj.status}.`, { match_id: match.match_id, from: proj.status, to: 'completed' });
        if (proj.home.score === proj.away.score && !sport.draw_allowed && !proj.tiebreak_winner_team_id)
          throw conflict('TIE_NOT_ALLOWED', 'Scores are level and this sport does not allow draws.', { match_id: match.match_id });
        return;
      case 'compensation': {
        const target = events.find((e) => e.event_id === p.compensates);
        if (!target) {
          return; // resolved by caller-level lookup below (other match or missing)
        }
        if (proj.compensatedBy.has(target.event_id) || !['score', 'discipline', 'tiebreak_winner'].includes(target.type))
          throw conflict('INVALID_COMPENSATION', `Event ${p.compensates} cannot be compensated.`, { compensates: p.compensates });
        return;
      }
    }
  }

  private async insert(c: Tx, request: any, seq: number): Promise<EventResult> {
    if (request.type === 'compensation') await this.checkCompensationTarget(c, request);
    const signature = sign(request.event_id, request.payload);
    await c.query(
      'INSERT INTO match_events(match_id, seq, event_id, type, payload, signature, request) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [request.match_id, seq, request.event_id, request.type, JSON.stringify(request.payload), signature, JSON.stringify(request)],
    );
    return {
      status: 201,
      body: { event_id: request.event_id, match_id: request.match_id, type: request.type, sequence: seq, match_version: seq, signature },
    };
  }

  private async checkCompensationTarget(c: Tx, request: any) {
    const r = await c.query('SELECT match_id FROM match_events WHERE event_id=$1', [request.payload.compensates]);
    if (!r.rowCount) throw notFound('EVENT_NOT_FOUND', `Event ${request.payload.compensates} does not exist.`, { event_id: request.payload.compensates });
    if (r.rows[0].match_id !== request.match_id)
      throw conflict('INVALID_COMPENSATION', 'The target event belongs to another match.', { compensates: request.payload.compensates });
  }

  // Spec 5.9 GET /score: projection rebuilt from the log on every read.
  async score(matchId: string) {
    const m = await this.loadMatch(this.db.pool, matchId);
    if (!m) throw notFound('MATCH_NOT_FOUND', `Match ${matchId} does not exist.`, { match_id: matchId });
    const proj = project(m.sport, m.match, m.events);
    return {
      match_id: m.match.match_id,
      sport_id: m.match.sport_id,
      league_id: m.match.league_id,
      status: proj.status,
      outcome: proj.outcome,
      winner_team_id: proj.winner_team_id,
      tiebreak_winner_team_id: proj.tiebreak_winner_team_id,
      home: proj.home,
      away: proj.away,
      version: proj.version,
      events: m.events.map((e) => ({
        sequence: e.seq, event_id: e.event_id, type: e.type, payload: e.payload, signature: e.signature,
        compensated: proj.compensatedBy.has(e.event_id), compensated_by: proj.compensatedBy.get(e.event_id) ?? null,
      })),
    };
  }
}
