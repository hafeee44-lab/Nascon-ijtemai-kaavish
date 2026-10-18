import { EventEmitter } from 'node:events';
import { ApiError } from '../common/api-error.js';
import { FakeDb } from '../test/fake-db.js';
import { isFlood, isProfane, mask, moderate, normalizedForms, SenderLimiter } from './moderation.js';
import { deliverWithRetry, ModerationService } from './moderation.service.js';

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };

describe('leetspeak + flood rules (FR-5.3)', () => {
  it('normalises obfuscation', () => {
    expect(normalizedForms('b@d_w0rd')).toContain('badword');
    expect(normalizedForms('s!c@m')).toContain('scam');
    for (const w of ['p.0.r.n', 'f*u*c*k', 'a$$h0le', 'sh1t', 'idiot_spam', 'BITCH']) expect(isProfane(w)).toBe(true);
    expect(isProfane('commentary')).toBe(false);
  });
  it('masks only offending tokens and keeps spacing', () => {
    expect(mask('Watch this illegal stream b@d_w0rd now!')).toEqual({ text: 'Watch this illegal stream *** now!', flagged: true });
    expect(mask('Clean  sports')).toEqual({ text: 'Clean  sports', flagged: false });
  });
  it('detects character floods', () => {
    expect(isFlood('GOAL! AAAA!!!')).toBe(true);
    expect(isFlood('what???')).toBe(true);
    expect(isFlood('goooal')).toBe(false);
    expect(isFlood('great match!')).toBe(false);
  });
  it('drops floods, flags profanity, dedupes senders', () => {
    const r = moderate([
      { message_id: '1', sender: 'a', text: 'nice' },
      { message_id: '2', sender: 'b', text: 'scam scam' },
      { message_id: '3', sender: 'b', text: 'b@dword' },
      { message_id: '4', sender: 'c', text: 'NOOOOO' },
    ]);
    expect(r.filtered.map((m) => m.message_id)).toEqual(['1', '2', '3']);
    expect([r.kicked, r.muted]).toEqual([['b'], ['c']]);
  });
  it('rate-limits 3 messages per 2 s per sender', () => {
    let t = 0;
    const l = new SenderLimiter(3, 2000, () => t);
    expect([l.allow('u'), l.allow('u'), l.allow('u'), l.allow('u')]).toEqual([true, true, true, false]);
    t = 2500;
    expect(l.allow('u')).toBe(true);
  });
});

describe('notification retry + DLQ (FR-5.2)', () => {
  it('retries with backoff and reports attempts', async () => {
    let n = 0;
    expect(await deliverWithRetry(async () => { if (++n < 2) throw new Error('x'); }, 3, 1)).toEqual({ ok: true, attempts: 2 });
    expect((await deliverWithRetry(async () => { throw new Error('down'); }, 3, 1))).toEqual({ ok: false, attempts: 3, error: 'down' });
  });

  async function setup() {
    const db = new FakeDb();
    const emitted: any[] = [];
    return { db, emitted, svc: new ModerationService(db as any, { bus: new EventEmitter(), emit: async (type: string, data: any) => { emitted.push({ type, data }); } } as any) };
  }

  it('runs the audit probe deterministically with DLQ inspection', async () => {
    process.env.DAY2_SALT = 'unit-salt';
    const { svc } = await setup();
    const body = { chat_room_id: 'chat-x', incoming_messages: [
      { message_id: 'm1', sender: 'g', text: 'Clean sports commentary' },
      { message_id: 'm2', sender: 'spam', text: 'b@d_w0rd' },
      { message_id: 'm3', sender: 'flood', text: 'AAAA' }], check_dlq: true };
    const r = await svc.test(body);
    expect([r.kicked_users, r.muted_users, r.dlq_status.queue_depth]).toEqual([['spam'], ['flood'], 0]);
    const again = await svc.test({ ...body, incoming_messages: [body.incoming_messages[0]], simulate_failed_notifications: 2 });
    expect([again.kicked_users, again.dlq_status.queue_depth, again.dlq_status.undelivered_events[0].attempts]).toEqual([['spam'], 2, 3]);
    expect(await svc.depth()).toBe(2);
    expect(await code(svc.test({ chat_room_id: '', incoming_messages: [] }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.test({ chat_room_id: 'r', incoming_messages: [], simulate_failed_notifications: -1, check_dlq: 'x' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.test(null))).toBe('VALIDATION_ERROR');
    expect((await svc.test({ chat_room_id: 'fresh', incoming_messages: [] })).kicked_users).toEqual([]);
  });

  it('live chat: persists clean/masked messages, blocks floods, muted and rate-limited senders', async () => {
    const { svc, emitted } = await setup();
    const ok = await svc.post('u1', { chat_room_id: 'r', text: 'what a shit pass' });
    expect([ok.accepted, ok.message?.text, ok.message?.seq]).toEqual([true, 'what a *** pass', 1]);
    expect(emitted[0].type).toBe('chat.message');
    expect((await svc.post('u2', { chat_room_id: 'r', text: 'AAAA' })).reason).toBe('flood_character_repeat');
    await svc.post('u3', { chat_room_id: 'r', text: 'a' });
    await svc.post('u3', { chat_room_id: 'r', text: 'b' });
    await svc.post('u3', { chat_room_id: 'r', text: 'c' });
    expect((await svc.post('u3', { chat_room_id: 'r', text: 'd' })).reason).toBe('rate_limit_exceeded');
    await svc.test({ chat_room_id: 'r', incoming_messages: [{ message_id: 'k', sender: 'u4', text: 'scam' }] });
    expect((await svc.post('u4', { chat_room_id: 'r', text: 'hello' })).reason).toBe('sender_muted');
    expect(await code(svc.post('u5', { chat_room_id: 'r', text: '' }))).toBe('VALIDATION_ERROR');
    const h = await svc.history('r');
    expect(h.messages.map((m: any) => m.text)).toEqual(['what a *** pass', 'a', 'b', 'c']);
  });
});

describe('moderator actions', () => {
  it('kick/mute/unmute are role-gated, validated and deduplicated', async () => {
    const db = new FakeDb();
    const svc = new ModerationService(db as any, { bus: new EventEmitter(), emit: async () => undefined } as any);
    const mod: any = { sub: 'm', role: 'league_organizer' };
    await svc.act(mod, 'r', { action: 'kick', user_id: 'x' });
    await svc.act(mod, 'r', { action: 'kick', user_id: 'x' });
    expect((await svc.act(mod, 'r', { action: 'mute', user_id: 'x' })).muted_users).toEqual(['x']);
    expect(await svc.act(mod, 'r', { action: 'unmute', user_id: 'x' })).toEqual({ chat_room_id: 'r', kicked_users: [], muted_users: [] });
    expect(await code(svc.act({ sub: 'v', role: 'viewer' } as any, 'r', { action: 'kick', user_id: 'x' }))).toBe('FORBIDDEN');
    expect(await code(svc.act(mod, 'r', { action: 'ban', user_id: 'x' }))).toBe('VALIDATION_ERROR');
  });
});
