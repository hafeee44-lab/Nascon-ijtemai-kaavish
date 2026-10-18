import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { conflict, notFound, validationError } from '../common/api-error.js';
import { signDay2 } from '../common/canonical.js';
import { isObj, isStr } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import { playerExists } from './players.js';

const ACTIONS = ['generate', 'rotate', 'revoke'];
const host = () => (process.env.MEDIA_PUBLIC_HOST ?? 'localhost');

export const newStreamKey = () => 'sk_live_' + randomBytes(8).toString('hex');

export function keyView(k: { player_id: string; label: string; stream_key: string; status: string }, action: string) {
  const active = k.status === 'active';
  return {
    player_id: k.player_id,
    label: k.label,
    stream_key: k.stream_key,
    status: k.status,
    ingest_endpoints: active
      ? { rtmp: `rtmp://${host()}:1935/live/${k.stream_key}`, webrtc: `http://${host()}:8889/live/${k.stream_key}/whip` }
      : null,
    playback_url: active ? `http://${host()}:8888/live/${k.stream_key}/index.m3u8` : null,
    signature: signDay2(k.stream_key, { action, player_id: k.player_id, status: k.status, stream_key: k.stream_key }),
  };
}

// FR-3.2 / spec §5.4: one active key per player; rotate/revoke invalidate the old key immediately.
@Injectable()
export class StreamKeysService {
  constructor(private readonly db: Db, private readonly events: DomainEvents) {}

  async handle(b: any): Promise<{ status: number; body: any }> {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!ACTIONS.includes(b.action)) bad.push('action');
    if (!isStr(b.player_id) || !b.player_id) bad.push('player_id');
    if (b.label !== undefined && b.label !== null && (!isStr(b.label) || b.label.length < 1 || b.label.length > 64)) bad.push('label');
    if (b.stream_key_override !== undefined && b.stream_key_override !== null && (!isStr(b.stream_key_override) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(b.stream_key_override)))
      bad.push('stream_key_override');
    if (bad.length) throw validationError(bad);
    if (!(await playerExists(this.db, b.player_id))) throw notFound('PLAYER_NOT_FOUND', `Player ${b.player_id} does not exist.`, { player_id: b.player_id });

    return this.db.tx(async (c) => {
      await c.query(`INSERT INTO docs(kind,id,data) VALUES('stream_owner',$1,'{}') ON CONFLICT DO NOTHING`, [b.player_id]);
      const owner = await this.db.getForUpdate(c, 'stream_owner', b.player_id);
      const current = owner?.stream_key ? await this.db.get('stream_key', owner.stream_key, c) : null;

      if (b.action === 'revoke') {
        if (!current) throw notFound('STREAM_NOT_FOUND', `No stream key exists for ${b.player_id}.`, { player_id: b.player_id });
        current.status = 'revoked';
        await this.db.put('stream_key', current.stream_key, current, c);
        await this.events.emit('stream.key_revoked', { player_id: b.player_id, stream_key: current.stream_key });
        return { status: 200, body: keyView(current, 'revoke') };
      }

      const key = b.stream_key_override ?? newStreamKey();
      const existing = await this.db.get('stream_key', key, c);
      if (existing?.status === 'revoked') throw conflict('KEY_REVOKED', 'This stream key has been revoked.', { stream_key: key });
      if (current && current.stream_key !== key && current.status === 'active') {
        current.status = 'revoked';
        await this.db.put('stream_key', current.stream_key, current, c);
        await this.events.emit('stream.key_revoked', { player_id: b.player_id, stream_key: current.stream_key });
      }
      const record = { player_id: b.player_id, label: b.label ?? current?.label ?? 'default', stream_key: key, status: 'active', created_at: new Date().toISOString() };
      await this.db.put('stream_key', key, record, c);
      await this.db.put('stream_owner', b.player_id, { player_id: b.player_id, stream_key: key }, c);
      return { status: b.action === 'generate' ? 201 : 200, body: keyView(record, b.action) };
    });
  }

  /** Media-server publish/read check: 409 KEY_REVOKED for revoked keys, 404 for unknown. */
  async authorize(key: string) {
    const k = await this.db.get('stream_key', key);
    if (!k) throw notFound('STREAM_NOT_FOUND', 'Unknown stream key.', { stream_key: key });
    if (k.status !== 'active') throw conflict('KEY_REVOKED', 'This stream key has been revoked.', { stream_key: key });
    return { stream_key: key, player_id: k.player_id, status: 'active' };
  }

  async activeCount() {
    const r = await this.db.query(`SELECT count(*)::int AS n FROM docs WHERE kind='stream_key' AND data->>'status'='active'`);
    return r.rows[0].n as number;
  }
}
