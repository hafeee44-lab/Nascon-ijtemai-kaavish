import { Injectable } from '@nestjs/common';
import { ApiError, conflict, notFound, validationError } from '../common/api-error.js';
import { canonical } from '../common/canonical.js';
import { addDays, isDate, isId, isObj, isStr, nowIso, today } from '../common/validate.js';
import { Db, Tx } from '../db/db.service.js';
import type { SportConfig } from '../sports/sport-config.js';

const ROLES = ['captain', 'vice_captain', 'starter', 'substitute'];
const TYPES = ['transfer', 'loan', 'release'];

export interface Registration {
  player_id: string; league_id: string; squad_id: string | null; parent_squad_id: string | null;
  registration_type: string; start_date: string | null; loan_end_date: string | null; role: string;
}
interface PlayerState { player_id: string; name: string; position: string; reg: Registration }
export interface RosterLeague {
  league: { league_id: string; tenant_id: string; sport_id: string; transfer_window: { open: string; close: string }; max_squad_size: number; required_positions: Record<string, number> };
  squads: Record<string, { squad_id: string; club_id: string; tenant_id: string; name: string }>;
  players: Record<string, PlayerState>;
  matches_in_progress: { match_id: string; home_squad_id: string; away_squad_id: string }[];
}

// Squad a registration places the player in on a given date (loans auto-return the day after loan_end_date).
export function squadOn(reg: Registration, date: string): string | null {
  if (reg.registration_type === 'loan' && reg.loan_end_date && date > reg.loan_end_date) return reg.parent_squad_id;
  return reg.squad_id;
}
export const onLoan = (reg: Registration, date: string) =>
  reg.registration_type === 'loan' && !!reg.loan_end_date && date <= reg.loan_end_date;

@Injectable()
export class RosterService {
  constructor(private readonly db: Db) {}

  // Spec 5.11 setup: (re)builds one league's roster scenario.
  async setup(b: any) {
    if (!isObj(b) || !isObj(b.league)) throw validationError(['league']);
    const l = b.league;
    const bad: string[] = [];
    if (!isId(l.league_id)) bad.push('league.league_id');
    if (!isId(l.tenant_id)) bad.push('league.tenant_id');
    if (!isId(l.sport_id)) bad.push('league.sport_id');
    if (!isObj(l.transfer_window) || !isDate(l.transfer_window.open) || !isDate(l.transfer_window.close)) bad.push('league.transfer_window');
    if (l.max_squad_size !== undefined && !(Number.isInteger(l.max_squad_size) && l.max_squad_size >= 1)) bad.push('league.max_squad_size');
    if (l.required_positions !== undefined && !isObj(l.required_positions)) bad.push('league.required_positions');
    const squads = b.squads ?? [];
    if (!Array.isArray(squads) || !squads.every((s: any) => isObj(s) && isId(s.squad_id) && isId(s.club_id) && isId(s.tenant_id))) bad.push('squads');
    const players = b.players ?? [];
    if (!Array.isArray(players) || !players.every((p: any) => isObj(p) && isId(p.player_id) && isStr(p.position) && (p.squad_id === null || isId(p.squad_id)) &&
      (p.role === undefined || ROLES.includes(p.role))))
      bad.push('players');
    const mip = b.matches_in_progress ?? [];
    if (!Array.isArray(mip) || !mip.every((m: any) => isObj(m) && isId(m.match_id))) bad.push('matches_in_progress');
    if (bad.length) throw validationError(bad);

    const sport = await this.db.get<SportConfig>('sport', l.sport_id);
    if (!sport) throw notFound('SPORT_NOT_FOUND', `Sport ${l.sport_id} does not exist.`, { sport_id: l.sport_id });
    const state: RosterLeague = {
      league: {
        league_id: l.league_id, tenant_id: l.tenant_id, sport_id: l.sport_id,
        transfer_window: { open: l.transfer_window.open, close: l.transfer_window.close },
        max_squad_size: l.max_squad_size ?? sport.roster.max_squad_size,
        required_positions: l.required_positions ?? sport.roster.required_positions,
      },
      squads: Object.fromEntries(squads.map((s: any) => [s.squad_id, { squad_id: s.squad_id, club_id: s.club_id, tenant_id: s.tenant_id, name: s.name ?? s.squad_id }])),
      players: {},
      matches_in_progress: mip.map((m: any) => ({ match_id: m.match_id, home_squad_id: m.home_squad_id, away_squad_id: m.away_squad_id })),
    };
    for (const p of players) {
      if (p.squad_id && !state.squads[p.squad_id]) throw notFound('SQUAD_NOT_FOUND', `Squad ${p.squad_id} does not exist.`, { squad_id: p.squad_id });
      state.players[p.player_id] = {
        player_id: p.player_id, name: p.name ?? p.player_id, position: p.position,
        reg: { player_id: p.player_id, league_id: l.league_id, squad_id: p.squad_id, parent_squad_id: null, registration_type: 'initial', start_date: null, loan_end_date: null, role: p.role ?? 'substitute' },
      };
    }
    await this.db.tx(async (c) => {
      const old = await this.db.get<RosterLeague>('roster_league', l.league_id, c);
      if (old) {
        for (const pid of Object.keys(old.players)) {
          await c.query(`DELETE FROM docs WHERE kind='roster_player' AND id=$1`, [pid]);
          await c.query('DELETE FROM roster_audit WHERE player_id=$1', [pid]);
        }
        await c.query(`DELETE FROM docs WHERE kind='roster_request' AND data->>'league_id'=$1`, [l.league_id]);
      }
      await this.db.put('roster_league', l.league_id, state, c);
      for (const pid of Object.keys(state.players)) await this.db.put('roster_player', pid, { player_id: pid, league_id: l.league_id }, c);
    });
    const squad_counts: Record<string, number> = {};
    for (const sid of Object.keys(state.squads)) squad_counts[sid] = Object.values(state.players).filter((p) => p.reg.squad_id === sid).length;
    return { league_id: l.league_id, status: 'configured', squad_counts };
  }

  validateTransfer(b: any) {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    for (const f of ['request_id', 'league_id', 'player_id', 'from_squad_id']) if (!isId(b[f])) bad.push(f);
    if (!TYPES.includes(b.type)) bad.push('type');
    if (b.type !== 'release' && !isId(b.to_squad_id)) bad.push('to_squad_id');
    if (b.type === 'release' && b.to_squad_id !== null && b.to_squad_id !== undefined) bad.push('to_squad_id');
    if (!isDate(b.effective_date)) bad.push('effective_date');
    if (b.type === 'loan') {
      if (!isDate(b.loan_end_date) || (isDate(b.effective_date) && b.loan_end_date <= b.effective_date)) bad.push('loan_end_date');
    } else if (b.loan_end_date !== undefined && b.loan_end_date !== null) bad.push('loan_end_date');
    if (b.reason !== undefined && b.reason !== null && !isStr(b.reason)) bad.push('reason');
    if (b.requested_by !== undefined && b.requested_by !== null && !isStr(b.requested_by)) bad.push('requested_by');
    if (bad.length) throw validationError(bad);
  }

  private async nextAuditId(c: Tx) {
    const r = await c.query(`SELECT count(*)::int AS n FROM roster_audit`);
    return `au-${String(r.rows[0].n + 1).padStart(4, '0')}`;
  }

  private async writeAudit(c: Tx, entry: any) {
    await c.query('INSERT INTO roster_audit(audit_id, player_id, data) VALUES ($1,$2,$3)', [entry.audit_id, entry.player_id, JSON.stringify(entry)]);
  }

  // Writes the loan_return entry exactly once, the first time a date after loan_end_date is observed.
  private async materializeReturn(c: Tx, st: RosterLeague, p: PlayerState, date: string) {
    const reg = p.reg;
    if (reg.registration_type !== 'loan' || !reg.loan_end_date || date <= reg.loan_end_date) return false;
    const entry = {
      audit_id: await this.nextAuditId(c), action: 'loan_return', player_id: p.player_id, league_id: st.league.league_id,
      from_squad_id: reg.squad_id, to_squad_id: reg.parent_squad_id, effective_date: addDays(reg.loan_end_date, 1),
      state: 'active', who: 'system', when: nowIso(), why: 'Loan period ended; automatic return to parent club.',
    };
    await this.writeAudit(c, entry);
    p.reg = { ...reg, squad_id: reg.parent_squad_id, parent_squad_id: null, registration_type: 'loan_return', start_date: entry.effective_date, loan_end_date: null, role: 'substitute' };
    return true;
  }

  auditCount = async (playerId: string, c: Tx | Db['pool'] = this.db.pool) =>
    (await c.query('SELECT count(*)::int AS n FROM roster_audit WHERE player_id=$1', [playerId])).rows[0].n as number;

  async transfer(b: any): Promise<{ status: number; body: any }> {
    this.validateTransfer(b);
    const request = {
      request_id: b.request_id, league_id: b.league_id, player_id: b.player_id, type: b.type, from_squad_id: b.from_squad_id,
      to_squad_id: b.type === 'release' ? null : b.to_squad_id, effective_date: b.effective_date, loan_end_date: b.loan_end_date ?? null,
      reason: b.reason ?? null, requested_by: b.requested_by ?? null,
    };
    const prior = await this.db.get('roster_request', request.request_id);
    if (prior) {
      if (canonical(prior.request) !== canonical(request))
        throw conflict('DUPLICATE_REQUEST_ID', `Request ${request.request_id} was already used with a different body.`, { request_id: request.request_id });
      return { status: 200, body: prior.body };
    }
    return this.db.tx(async (c) => {
      const st = await this.db.getForUpdate<RosterLeague>(c, 'roster_league', request.league_id);
      if (!st) throw notFound('LEAGUE_NOT_FOUND', `League ${request.league_id} does not exist.`, { league_id: request.league_id });
      const p = st.players[request.player_id];
      if (!p) throw notFound('PLAYER_NOT_FOUND', `Player ${request.player_id} does not exist.`, { player_id: request.player_id });
      for (const sid of [request.from_squad_id, request.to_squad_id])
        if (sid !== null && !st.squads[sid]) throw notFound('SQUAD_NOT_FOUND', `Squad ${sid} does not exist.`, { squad_id: sid });
      const date = request.effective_date;
      const returned = await this.materializeReturn(c, st, p, date);

      const tenant = st.league.tenant_id;
      for (const sid of [request.from_squad_id, request.to_squad_id])
        if (sid !== null && st.squads[sid].tenant_id !== tenant)
          throw conflict('CROSS_TENANT_TRANSFER', 'Both squads must belong to the league tenant.', { squad_id: sid, tenant_id: tenant });
      if (squadOn(p.reg, date) !== request.from_squad_id)
        throw conflict('NOT_IN_SQUAD', `Player ${p.player_id} is not in squad ${request.from_squad_id}.`, { player_id: p.player_id, squad_id: request.from_squad_id });
      const w = st.league.transfer_window;
      if (request.type !== 'release' && (date < w.open || date > w.close))
        throw conflict('TRANSFER_WINDOW_CLOSED', 'The transfer window is closed on that date.', { effective_date: date, open: w.open, close: w.close });
      if (onLoan(p.reg, date)) throw conflict('PLAYER_ON_LOAN', `Player ${p.player_id} is currently on loan.`, { player_id: p.player_id });
      const members = (sid: string) => Object.values(st.players).filter((x) => squadOn(x.reg, date) === sid);
      if (request.type !== 'release' && members(request.to_squad_id!).length + 1 > st.league.max_squad_size)
        throw conflict('SQUAD_FULL', `Squad ${request.to_squad_id} is full.`, { squad_id: request.to_squad_id, max_squad_size: st.league.max_squad_size });
      const need = st.league.required_positions[p.position];
      if (need !== undefined && members(request.from_squad_id).filter((x) => x.position === p.position).length - 1 < need)
        throw conflict('MIN_POSITION_VIOLATION', `Squad ${request.from_squad_id} would have too few ${p.position} players.`, { squad_id: request.from_squad_id, position: p.position, required: need });

      const blocking = st.matches_in_progress.find((m) => m.home_squad_id === request.from_squad_id || m.away_squad_id === request.from_squad_id);
      const state = blocking ? 'deferred_until_match_end' : 'active';
      let registration: Registration | null = null;
      if (request.type === 'release') {
        p.reg = { ...p.reg, squad_id: null, parent_squad_id: null, registration_type: 'release', start_date: date, loan_end_date: null };
      } else {
        registration = {
          player_id: p.player_id, league_id: st.league.league_id, squad_id: request.to_squad_id,
          parent_squad_id: request.type === 'loan' ? request.from_squad_id : null, registration_type: request.type,
          start_date: date, loan_end_date: request.type === 'loan' ? request.loan_end_date : null, role: 'substitute',
        };
        p.reg = registration;
      }
      const audit_entry = {
        audit_id: await this.nextAuditId(c), action: request.type, player_id: p.player_id, league_id: st.league.league_id,
        from_squad_id: request.from_squad_id, to_squad_id: request.to_squad_id, effective_date: date, state,
        who: request.requested_by, when: nowIso(), why: request.reason,
      };
      await this.writeAudit(c, audit_entry);
      await this.db.put('roster_league', st.league.league_id, st, c);
      const body = { request_id: request.request_id, status: 'accepted', state, blocking_match_id: blocking?.match_id ?? null, registration, audit_entry };
      await this.db.put('roster_request', request.request_id, { request, body, league_id: st.league.league_id }, c);
      void returned;
      return { status: 201, body };
    });
  }

  async history(playerId: string, asOf?: string) {
    if (asOf !== undefined && !isDate(asOf)) throw validationError(['as_of']);
    const date = asOf ?? today();
    const link = await this.db.get('roster_player', playerId);
    if (!link) throw notFound('PLAYER_NOT_FOUND', `Player ${playerId} does not exist.`, { player_id: playerId });
    return this.db.tx(async (c) => {
      const st = (await this.db.getForUpdate<RosterLeague>(c, 'roster_league', link.league_id))!;
      const p = st.players[playerId];
      if (await this.materializeReturn(c, st, p, date)) await this.db.put('roster_league', st.league.league_id, st, c);
      const r = await c.query('SELECT data FROM roster_audit WHERE player_id=$1 ORDER BY seq', [playerId]);
      return {
        player_id: playerId, as_of: date, league_id: st.league.league_id,
        current_squad_id: squadOn(p.reg, date), parent_squad_id: onLoan(p.reg, date) ? p.reg.parent_squad_id : null,
        history: r.rows.map((x) => x.data),
      };
    });
  }
}

export { ApiError };
