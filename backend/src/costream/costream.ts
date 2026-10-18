import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiError, conflict, notFound, validationError } from '../common/api-error.js';
import { canonical, signDay2 } from '../common/canonical.js';
import { isBool, isObj, isStr } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import type { Principal } from '../rbac/policy.js';
import { playerExists } from '../streaming/players.js';

const LAYOUTS = ['solo', 'grid_2', 'grid_4', 'spotlight'];
const hlsHost = () => process.env.MEDIA_PUBLIC_HOST ?? 'localhost';

export interface CostreamRequest {
  session_id: string; host_player_id: string; participants: string[]; layout: string; simulate_host_drop: boolean;
}

/** Pure state machine for spec §5.5 rule 4–5 (after existence checks). */
export function resolveSession(r: CostreamRequest) {
  if (r.participants.length > 4)
    throw conflict('COSTREAM_SESSION_FULL', 'A co-stream supports at most 4 broadcasters.', { session_id: r.session_id, max: 4, requested: r.participants.length });
  let active = [...r.participants];
  let active_host: string | null = r.host_player_id;
  let handoff_occurred = false;
  let status = 'active';
  if (r.simulate_host_drop) {
    if (r.participants.length >= 2) {
      active = r.participants.filter((p) => p !== r.host_player_id);
      active_host = active[0];
      handoff_occurred = true;
    } else {
      active = [];
      active_host = null;
      status = 'terminated';
    }
  }
  const effective = active.length;
  if ((r.layout === 'solo' && effective > 1) || (r.layout === 'grid_2' && effective > 2))
    throw new ApiError(400, 'UNSUPPORTED_LAYOUT', `Layout ${r.layout} cannot fit ${effective} participants.`, { layout: r.layout, participant_count: effective });
  const participant_count = effective;
  const body = {
    session_id: r.session_id,
    status,
    active_host,
    handoff_occurred,
    participant_count,
    active_participants: active,
    layout: r.layout,
    composite_playback_url: `http://${hlsHost()}:8888/costream/${r.session_id}/index.m3u8`,
    chat_room_id: `chat-${r.session_id}`,
    signature: signDay2(r.session_id, { active_host, handoff_occurred, layout: r.layout, participant_count, session_id: r.session_id, status }),
  };
  return body;
}

@Injectable()
export class CostreamService {
  constructor(private readonly db: Db, private readonly events: DomainEvents) {}

  parse(b: any): CostreamRequest {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!isStr(b.session_id) || !b.session_id) bad.push('session_id');
    if (!isStr(b.host_player_id) || !b.host_player_id) bad.push('host_player_id');
    const p = b.participants;
    if (!Array.isArray(p) || p.length === 0 || !p.every((x: any) => isStr(x) && x.length > 0) || new Set(p).size !== p.length) bad.push('participants');
    if (b.simulate_host_drop !== undefined && !isBool(b.simulate_host_drop)) bad.push('simulate_host_drop');
    if (b.layout !== undefined && b.layout !== null && !LAYOUTS.includes(b.layout)) bad.push('layout');
    if (bad.length) throw validationError(bad);
    return { session_id: b.session_id, host_player_id: b.host_player_id, participants: p, layout: b.layout ?? 'grid_4', simulate_host_drop: b.simulate_host_drop ?? false };
  }

  async open(b: any): Promise<{ status: number; body: any }> {
    const r = this.parse(b);
    for (const id of [...new Set([...r.participants, r.host_player_id])])
      if (!(await playerExists(this.db, id))) throw notFound('PLAYER_NOT_FOUND', `Player ${id} does not exist.`, { player_id: id });
    if (!r.participants.includes(r.host_player_id)) throw validationError(['host_player_id'], 'host_player_id must be one of the participants.');
    const prior = await this.db.get('costream', r.session_id);
    if (prior && canonical(prior.request) === canonical(r)) return { status: 200, body: prior.body };
    const body = resolveSession(r);
    await this.db.put('costream', r.session_id, { request: r, body, updated_at: new Date().toISOString() });
    await this.events.emit('costream.session_updated', { session_id: r.session_id, status: body.status, active_host: body.active_host, handoff_occurred: body.handoff_occurred });
    return { status: 201, body };
  }

  get(id: string) {
    return this.db.get('costream', id);
  }

  /** Active sessions, newest first — lets the app offer "join a co-stream" without a deep link. */
  async list() {
    const r = await this.db.query(`SELECT data FROM docs WHERE kind='costream' AND data->'body'->>'status'='active' ORDER BY data->>'updated_at' DESC LIMIT 20`);
    return r.rows.map((x: any) => {
      const b = x.data.body;
      return { session_id: b.session_id, active_host: b.active_host, participant_count: b.participant_count, layout: b.layout, status: b.status };
    });
  }

  private async mutate(id: string, fn: (body: any) => any, eventType: string) {
    return this.db.tx(async (c) => {
      const doc = await this.db.getForUpdate(c, 'costream', id);
      if (!doc) throw notFound('STREAM_NOT_FOUND', `Co-stream ${id} does not exist.`, { session_id: id });
      const body = fn(structuredClone(doc.body));
      await this.db.put('costream', id, { ...doc, body, updated_at: new Date().toISOString() }, c);
      await this.events.emit(eventType, { session_id: id, status: body.status, active_host: body.active_host, active_participants: body.active_participants });
      return body;
    });
  }

  private async requireHost(me: Principal, id: string) {
    const doc = await this.db.get('costream', id);
    if (!doc) throw notFound('STREAM_NOT_FOUND', `Co-stream ${id} does not exist.`, { session_id: id });
    if (me.role !== 'super_admin' && me.player_id !== doc.body.active_host)
      throw new ApiError(403, 'FORBIDDEN', 'Only the active host can manage this co-stream.', { session_id: id });
    return doc.body;
  }

  async invite(me: Principal, id: string, b: any) {
    if (!isObj(b) || !isStr(b.player_id) || !b.player_id) throw validationError(['player_id']);
    await this.requireHost(me, id);
    if (!(await playerExists(this.db, b.player_id))) throw notFound('PLAYER_NOT_FOUND', `Player ${b.player_id} does not exist.`, { player_id: b.player_id });
    const exp = Date.now() + INVITE_TTL_MS;
    const invite_token = inviteToken(id, b.player_id, exp);
    await this.events.emit('costream.invite', { session_id: id, player_id: b.player_id });
    return { session_id: id, player_id: b.player_id, invite_token, expires_at: new Date(exp).toISOString(), join_url: `nascon://stream/${id}` };
  }

  async join(id: string, b: any) {
    const playerId = verifyInvite(b?.invite_token, id);
    return this.mutate(id, (body) => {
      if (body.active_participants.includes(playerId)) return body;
      if (body.active_participants.length >= 4)
        throw conflict('COSTREAM_SESSION_FULL', 'A co-stream supports at most 4 broadcasters.', { session_id: id, max: 4 });
      body.active_participants.push(playerId);
      if (!body.active_host) body.active_host = playerId;
      body.status = 'active';
      return resign(body);
    }, 'costream.joined');
  }

  async control(me: Principal, id: string, b: any) {
    const actions = ['mute', 'unmute', 'spotlight', 'kick'];
    if (!isObj(b) || !actions.includes(b.action) || !isStr(b.participant_id)) throw validationError(['action', 'participant_id']);
    await this.requireHost(me, id);
    return this.mutate(id, (body) => {
      if (!body.active_participants.includes(b.participant_id))
        throw notFound('PLAYER_NOT_FOUND', `${b.participant_id} is not in this co-stream.`, { participant_id: b.participant_id });
      body.muted = body.muted ?? [];
      if (b.action === 'mute' && !body.muted.includes(b.participant_id)) body.muted.push(b.participant_id);
      if (b.action === 'unmute') body.muted = body.muted.filter((p: string) => p !== b.participant_id);
      if (b.action === 'spotlight') { body.spotlight = b.participant_id; body.layout = 'spotlight'; }
      if (b.action === 'kick') {
        if (b.participant_id === body.active_host) throw validationError(['participant_id'], 'The host cannot kick themselves.');
        dropParticipant(body, b.participant_id);
      }
      return resign(body);
    }, 'costream.control');
  }

  /** WebSocket presence: called when a broadcaster's last connection drops (after a short grace period). */
  async disconnect(id: string, playerId: string) {
    const doc = await this.db.get('costream', id);
    if (!doc || !doc.body.active_participants.includes(playerId)) return null;
    return this.mutate(id, (body) => dropParticipant(body, playerId), 'costream.host_handoff');
  }
}

// ---------- FR-3.3 host tools: signed invites, live controls, disconnect handoff ----------

const INVITE_TTL_MS = 15 * 60 * 1000;

/** Invite token = base64url(canonical payload) + "." + DAY2 HMAC over (session_id | payload). */
export function inviteToken(sessionId: string, playerId: string, exp = Date.now() + INVITE_TTL_MS): string {
  const payload = { exp, player_id: playerId, session_id: sessionId };
  return `${Buffer.from(canonical(payload)).toString('base64url')}.${signDay2(sessionId, payload)}`;
}

/** Returns the invited player id, or throws 403 for a forged, expired or foreign token. */
export function verifyInvite(token: unknown, sessionId: string, now = Date.now()): string {
  const bad = () => new ApiError(403, 'FORBIDDEN', 'This invite is invalid or has expired.', { session_id: sessionId });
  if (typeof token !== 'string' || !token.includes('.')) throw bad();
  const [body, sig] = token.split('.');
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  const expected = signDay2(String(payload?.session_id), payload);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw bad();
  if (payload.session_id !== sessionId || typeof payload.exp !== 'number' || payload.exp < now) throw bad();
  return payload.player_id;
}

/** Re-signs a session body after any state change, using the §5.3 payload. */
export function resign(body: any) {
  body.participant_count = body.active_participants.length;
  body.signature = signDay2(body.session_id, {
    active_host: body.active_host, handoff_occurred: body.handoff_occurred, layout: body.layout,
    participant_count: body.participant_count, session_id: body.session_id, status: body.status,
  });
  return body;
}

/** Deterministic handoff: the next participant in array order takes over; none left → terminated. */
export function dropParticipant(body: any, playerId: string) {
  const wasHost = body.active_host === playerId;
  body.active_participants = body.active_participants.filter((p: string) => p !== playerId);
  body.muted = (body.muted ?? []).filter((p: string) => p !== playerId);
  if (body.spotlight === playerId) body.spotlight = null;
  if (wasHost) {
    if (body.active_participants.length) {
      body.active_host = body.active_participants[0];
      body.handoff_occurred = true;
    } else {
      body.active_host = null;
      body.status = 'terminated';
    }
  }
  return resign(body);
}
