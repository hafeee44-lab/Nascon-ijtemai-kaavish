import { Injectable } from '@nestjs/common';
import { ApiError, validationError } from '../common/api-error.js';
import { canonical } from '../common/canonical.js';
import { isId, isInt, isObj, isStr } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { RosterService } from '../roster/roster.service.js';
import { EventsService } from '../scoring/events.service.js';

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export interface Result {
  action_id: string; status: 'applied' | 'rejected' | 'duplicate'; resolution: 'appended' | 'rebased_append' | 'server_wins' | 'skipped_duplicate';
  error_code: string | null; processed_order: number; server_version: number; signature: string | null;
}

// NFR-4 / spec 5.14: replay a device's offline queue, oldest first, reporting per-action outcomes.
@Injectable()
export class OfflineSyncService {
  constructor(private readonly db: Db, private readonly events: EventsService, private readonly roster: RosterService) {}

  async sync(b: any) {
    if (!isObj(b) || !isId(b.device_id)) throw validationError(['device_id']);
    const actions = b.actions;
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 100 ||
      !actions.every((a: any) => isObj(a) && isId(a.action_id) && ['score_event', 'roster_transfer'].includes(a.type) &&
        isStr(a.queued_at) && TS_RE.test(a.queued_at) && isInt(a.base_version) && a.base_version >= 0 && isObj(a.payload)))
      throw validationError(['actions']);

    const order = actions.map((a: any, i: number) => ({ a, i })).sort((x: any, y: any) =>
      x.a.queued_at < y.a.queued_at ? -1 : x.a.queued_at > y.a.queued_at ? 1 : x.i - y.i);
    const results: Result[] = new Array(actions.length);
    let n = 0;
    for (const { a, i } of order) results[i] = await this.process(b.device_id, a, ++n);
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return { device_id: b.device_id, results, summary: { applied: count('applied'), rejected: count('rejected'), duplicate: count('duplicate') } };
  }

  private version = async (a: any): Promise<number | null> => {
    if (a.type === 'score_event') {
      if (!isId(a.payload.match_id)) return null;
      const m = await this.db.get('match', a.payload.match_id);
      if (!m) return null;
      return (await this.db.query('SELECT count(*)::int AS n FROM match_events WHERE match_id=$1', [a.payload.match_id])).rows[0].n;
    }
    if (!isId(a.payload.player_id) || !(await this.db.get('roster_player', a.payload.player_id))) return null;
    return this.roster.auditCount(a.payload.player_id);
  };

  private async process(deviceId: string, a: any, processed_order: number): Promise<Result> {
    const key = `${deviceId}|${a.action_id}`;
    const base = { action_id: a.action_id, processed_order, signature: null as string | null };
    const current = async () => (await this.version(a)) ?? 0;
    const done = async (r: Result) => {
      await this.db.put('sync_action', key, r);
      return r;
    };

    if (await this.db.get('sync_action', key))
      return { ...base, status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await current() };

    const reject = async (code: string) =>
      done({ ...base, status: 'rejected', resolution: 'server_wins', error_code: code, server_version: await current() });

    // Same client id already applied with an identical body → duplicate (no change).
    if (a.type === 'score_event' && isId(a.payload.event_id)) {
      const r = await this.db.query('SELECT request FROM match_events WHERE event_id=$1', [a.payload.event_id]);
      if (r.rowCount) {
        const req = { event_id: a.payload.event_id, match_id: a.payload.match_id, type: a.payload.type, payload: a.payload.payload ?? {} };
        if (canonical(r.rows[0].request) === canonical(req))
          return done({ ...base, status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await current() });
        return reject('DUPLICATE_EVENT_ID');
      }
    }
    if (a.type === 'roster_transfer' && isId(a.payload.request_id)) {
      const prior = await this.db.get('roster_request', a.payload.request_id);
      if (prior) return done({ ...base, status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await current() });
    }

    const ver = await this.version(a);
    // Unknown match/player: the domain service produces the exact *_NOT_FOUND / VALIDATION_ERROR code
    // (or, for a match_init, simply creates the stream).
    if (ver !== null && a.base_version > ver) return reject('INVALID_BASE_VERSION');

    try {
      const resolution = ver === null || a.base_version === ver ? 'appended' : 'rebased_append';
      if (a.type === 'score_event') {
        const r = await this.events.append(a.payload);
        return done({ ...base, status: 'applied', resolution, error_code: null, server_version: r.body.match_version, signature: r.body.signature });
      }
      await this.roster.transfer(a.payload);
      return done({ ...base, status: 'applied', resolution, error_code: null, server_version: await current() });
    } catch (e) {
      if (e instanceof ApiError) return reject(e.code);
      throw e;
    }
  }
}
