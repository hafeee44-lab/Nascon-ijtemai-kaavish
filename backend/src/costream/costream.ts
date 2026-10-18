import { Injectable } from '@nestjs/common';
import { ApiError, conflict, notFound, validationError } from '../common/api-error.js';
import { canonical, signDay2 } from '../common/canonical.js';
import { isBool, isObj, isStr } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
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
}
