import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validationError } from '../common/api-error.js';
import { signDay2 } from '../common/canonical.js';
import { isBool, isInt, isObj, isStr } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import { moderate, SenderLimiter } from './moderation.js';
import { ApiError } from '../common/api-error.js';
import type { Principal } from '../rbac/policy.js';

const MODERATORS = ['super_admin', 'league_organizer', 'club_manager'];

/** FR-5.2: bounded exponential retry (3 attempts) before a notification lands in the DLQ. */
export async function deliverWithRetry(send: () => Promise<void>, attempts = 3, baseMs = 5): Promise<{ ok: boolean; attempts: number; error?: string }> {
  let lastErr = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      await send();
      return { ok: true, attempts: i };
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      if (i < attempts) await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    }
  }
  return { ok: false, attempts, error: lastErr };
}

@Injectable()
export class ModerationService {
  private readonly limiter = new SenderLimiter();
  constructor(private readonly db: Db, private readonly events: DomainEvents) {}

  async dlqStatus() {
    const r = await this.db.query('SELECT data FROM dlq ORDER BY seq');
    return { queue_depth: r.rowCount ?? 0, undelivered_events: r.rows.map((x) => x.data) };
  }

  async depth() {
    return (await this.db.query('SELECT count(*)::int AS n FROM dlq')).rows[0].n as number;
  }

  private async failNotification(room: string) {
    const event_id = `ntf-${randomUUID().slice(0, 12)}`;
    const result = await deliverWithRetry(async () => {
      throw new Error('subscriber disconnected (simulated)');
    });
    const data = { event_id, type: 'notification.delivery_failed', target: room, attempts: result.attempts, last_error: result.error, failed_at: new Date().toISOString() };
    await this.db.query('INSERT INTO dlq(event_id, data) VALUES ($1,$2)', [event_id, JSON.stringify(data)]);
  }

  // Spec §5.8: deterministic masking/flood rules; per-room kick/mute lists are deduplicated under concurrency.
  async test(b: any) {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!isStr(b.chat_room_id) || !b.chat_room_id) bad.push('chat_room_id');
    const msgs = b.incoming_messages;
    if (!Array.isArray(msgs) || !msgs.every((m: any) => isObj(m) && isStr(m.message_id) && isStr(m.sender) && isStr(m.text))) bad.push('incoming_messages');
    if (b.check_dlq !== undefined && !isBool(b.check_dlq)) bad.push('check_dlq');
    if (b.simulate_failed_notifications !== undefined && (!isInt(b.simulate_failed_notifications) || b.simulate_failed_notifications < 0 || b.simulate_failed_notifications > 100))
      bad.push('simulate_failed_notifications');
    if (bad.length) throw validationError(bad);
    const room: string = b.chat_room_id;
    const result = moderate(msgs.map((m: any) => ({ message_id: m.message_id, sender: m.sender, text: m.text })));

    for (let i = 0; i < (b.simulate_failed_notifications ?? 0); i++) await this.failNotification(room);

    let kicked: string[] = result.kicked;
    let muted: string[] = result.muted;
    if (result.kicked.length || result.muted.length) {
      ({ kicked, muted } = await this.db.tx(async (c) => {
        await c.query(`INSERT INTO docs(kind,id,data) VALUES('mod_room',$1,$2) ON CONFLICT DO NOTHING`, [room, JSON.stringify({ kicked: [], muted: [] })]);
        const st = await this.db.getForUpdate(c, 'mod_room', room);
        for (const u of result.kicked) if (!st.kicked.includes(u)) st.kicked.push(u);
        for (const u of result.muted) if (!st.muted.includes(u)) st.muted.push(u);
        await this.db.put('mod_room', room, st, c);
        return st;
      }));
    } else {
      const st = await this.db.get('mod_room', room);
      if (st) ({ kicked, muted } = st);
    }
    const dlq_status = await this.dlqStatus();
    const flagged_count = result.filtered.filter((m) => m.flagged).length;
    return {
      chat_room_id: room,
      filtered_messages: result.filtered,
      kicked_users: kicked,
      muted_users: muted,
      dlq_status,
      signature: signDay2(room, { chat_room_id: room, flagged_count, kicked_users: kicked, queue_depth: dlq_status.queue_depth }),
    };
  }

  // Live chat (members only — guests are stopped by the guard): moderate, rate-limit, persist, broadcast.
  async post(sender: string, b: any) {
    if (!isObj(b) || !isStr(b.chat_room_id) || !b.chat_room_id || !isStr(b.text) || b.text.length < 1 || b.text.length > 500)
      throw validationError(['chat_room_id', 'text']);
    if (!this.limiter.allow(sender)) return { accepted: false, reason: 'rate_limit_exceeded', flagged: true };
    const st = await this.db.get('mod_room', b.chat_room_id);
    if (st?.kicked?.includes(sender) || st?.muted?.includes(sender)) return { accepted: false, reason: 'sender_muted', flagged: true };
    const r = moderate([{ message_id: 'live', sender, text: b.text }]);
    if (!r.filtered.length) return { accepted: false, reason: 'flood_character_repeat', flagged: true };
    const m = r.filtered[0];
    const ins = await this.db.query('INSERT INTO chat_messages(room, sender, text, flagged, reason) VALUES ($1,$2,$3,$4,$5) RETURNING seq, created_at',
      [b.chat_room_id, sender, m.text, m.flagged, m.reason]);
    const msg = { seq: Number(ins.rows[0].seq), chat_room_id: b.chat_room_id, sender, text: m.text, flagged: m.flagged, reason: m.reason, at: ins.rows[0].created_at };
    await this.events.emit('chat.message', { ...msg, match_id: b.match_id ?? null });
    return { accepted: true, message: msg };
  }

  // Moderator kick/mute/unmute — idempotent and race-safe (row lock + deduplicated lists).
  async act(me: Principal, room: string, b: any) {
    if (!MODERATORS.includes(me.role)) throw new ApiError(403, 'FORBIDDEN', 'Only moderators can manage the chat.', { chat_room_id: room });
    if (!isObj(b) || !['kick', 'mute', 'unmute'].includes(b.action) || !isStr(b.user_id) || !b.user_id) throw validationError(['action', 'user_id']);
    const st = await this.db.tx(async (c) => {
      await c.query(`INSERT INTO docs(kind,id,data) VALUES('mod_room',$1,$2) ON CONFLICT DO NOTHING`, [room, JSON.stringify({ kicked: [], muted: [] })]);
      const s = await this.db.getForUpdate(c, 'mod_room', room);
      if (b.action === 'kick' && !s.kicked.includes(b.user_id)) s.kicked.push(b.user_id);
      if (b.action === 'mute' && !s.muted.includes(b.user_id)) s.muted.push(b.user_id);
      if (b.action === 'unmute') {
        s.kicked = s.kicked.filter((u: string) => u !== b.user_id);
        s.muted = s.muted.filter((u: string) => u !== b.user_id);
      }
      await this.db.put('mod_room', room, s, c);
      return s;
    });
    await this.events.emit('chat.moderation', { chat_room_id: room, action: b.action, user_id: b.user_id, by: me.sub });
    return { chat_room_id: room, kicked_users: st.kicked, muted_users: st.muted };
  }

  async history(room: string) {
    const r = await this.db.query('SELECT seq, sender, text, flagged, reason, created_at FROM chat_messages WHERE room=$1 ORDER BY seq DESC LIMIT 50', [room]);
    return { chat_room_id: room, messages: r.rows.reverse().map((x) => ({ ...x, seq: Number(x.seq) })) };
  }
}
