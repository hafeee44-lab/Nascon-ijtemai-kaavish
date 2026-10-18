import { EventEmitter } from 'node:events';
import { ApiError } from '../common/api-error.js';
import { signDay2 } from '../common/canonical.js';
import { BASE_SPORTS } from '../db/seed.js';
import { FakeDb } from '../test/fake-db.js';
import { guestGuard, guestTokenOf, isGuestWrite } from './guest-guard.js';
import { GuestService, mergeItems } from './guest.js';
import { deviceFamily, hourBucket, QrService, shortCodeFor, targetRoute } from './qr.js';

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };

describe('dynamic QR routing (FR-4.1)', () => {
  it('maps live state to routes', () => {
    expect(targetRoute('match', 'm', 'upcoming')).toBe('/web/matches/m/preview');
    expect(targetRoute('match', 'm', 'in_progress')).toBe('/web/matches/m/live');
    expect(targetRoute('match', 'm', 'completed')).toBe('/web/matches/m/vod');
    expect(targetRoute('match', 'm', 'postponed')).toBe('/web/matches/m/notice?state=postponed');
    expect(targetRoute('player', 'p', 'active')).toBe('/web/players/p');
    expect(targetRoute('club', 'c', 'active')).toBe('/web/clubs/c');
    expect(targetRoute('costream', 'cs', 'active')).toBe('/web/costream/cs');
  });
  it('keeps telemetry privacy-safe', () => {
    expect(deviceFamily('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe('mobile');
    expect(deviceFamily('Mozilla/5.0 (Macintosh)')).toBe('desktop');
    expect(deviceFamily(undefined)).toBe('desktop');
    expect(hourBucket(new Date('2026-10-18T07:42:10Z'))).toBe('2026-10-18T07:00Z');
    expect(shortCodeFor('match-x')).toMatch(/^[a-f0-9]{8}$/);
  });

  async function setup() {
    const db = new FakeDb();
    const football = BASE_SPORTS.find((s) => s.sport_id === 'football');
    let status: string = 'match_start';
    const events = {
      loadMatch: async (_p: unknown, id: string) => id === 'match-m1'
        ? { match: { match_id: id, sport_id: 'football', league_id: null, home_team_id: 'h', away_team_id: 'a' }, sport: football, events: [{ seq: 1, event_id: 'e', type: status, payload: {}, signature: '' }] }
        : null,
    };
    await db.put('qr', 'match-m1', { entity_id: 'match-m1', short_code: 'm1-live', scan_count: 0 });
    await db.put('qr_code', 'm1-live', { short_code: 'm1-live', entity_id: 'match-m1' });
    await db.put('scenario_player', 'player-alpha-1', { player_id: 'player-alpha-1' });
    await db.put('club', 'club-alpha-1', { club_id: 'club-alpha-1' });
    await db.put('costream', 'cs-session-1', { body: { status: 'active' } });
    const domain = { bus: new EventEmitter(), emit: async () => undefined };
    const qr = new QrService(db as any, events as any, domain as any);
    return { db, qr, domain, setStatus: (s: string) => { status = s; } };
  }

  it('resolves, counts scans (except inspect), mutates targets and exports', async () => {
    process.env.DAY2_SALT = 'unit-salt';
    const { qr, domain, setStatus } = await setup();
    const r = await qr.resolve('match-m1', { ua: 'iPhone' });
    expect([r.target_route, r.scan_count, r.short_url]).toEqual(['/web/matches/match-m1/live', 1, 'http://localhost:8080/q/m1-live']);
    expect(r.signature).toBe(signDay2('match-m1', { entity_id: 'match-m1', short_url: r.short_url, target_route: r.target_route }));
    expect((await qr.resolve('match-m1', { inspect: true })).scan_count).toBe(1);
    expect((await qr.byShortCode('m1-live')).scan_count).toBe(2);
    setStatus('match_end');
    domain.bus.emit('event', { type: 'match.status_changed', data: {} });
    expect((await qr.resolve('match-m1', { inspect: true })).target_route).toBe('/web/matches/match-m1/vod');
    expect((await qr.resolve('player-alpha-1', { inspect: true })).target_route).toBe('/web/players/player-alpha-1');
    expect((await qr.resolve('club-alpha-1', { inspect: true })).entity_type).toBe('club');
    expect((await qr.resolve('cs-session-1', { inspect: true })).entity_type).toBe('costream');
    expect(await code(qr.resolve('player-ghost'))).toBe('QR_NOT_FOUND');
    expect(await code(qr.resolve('club-ghost'))).toBe('QR_NOT_FOUND');
    expect(await code(qr.resolve('cs-session-ghost'))).toBe('QR_NOT_FOUND');
    expect(await code(qr.resolve('nothing'))).toBe('QR_NOT_FOUND');
    expect(await code(qr.byShortCode('zzz'))).toBe('QR_NOT_FOUND');
    expect((await qr.svg('match-m1')).trim().startsWith('<svg')).toBe(true);
    expect((await qr.png('match-m1')).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await qr.pdf('match-m1')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await qr.totalScans()).toBeGreaterThanOrEqual(2);
    qr.clearCache();
  });
});

describe('guest read-only boundary (FR-4.3)', () => {
  it('blocks guest writes, allows guest staging and members', () => {
    expect(guestTokenOf('Bearer guest_anon_tok_1')).toBe('guest_anon_tok_1');
    expect(guestTokenOf('Bearer eyJ.member')).toBeNull();
    expect(isGuestWrite('POST', '/api/v1/chat', 'Bearer guest_x')).toBe('guest_x');
    expect(isGuestWrite('POST', '/audit/v1/checkout', 'Bearer guest_x')).toBe('guest_x');
    expect(isGuestWrite('POST', '/audit/v1/events', 'Bearer guest_x')).toBe('guest_x');
    expect(isGuestWrite('POST', '/api/v1/guest/cart', 'Bearer guest_x')).toBeNull();
    expect(isGuestWrite('POST', '/audit/v1/guest/cart-merge', 'Bearer guest_x')).toBeNull();
    expect(isGuestWrite('GET', '/api/v1/chat/x', 'Bearer guest_x')).toBeNull();
    expect(isGuestWrite('POST', '/api/v1/chat', 'Bearer member')).toBeNull();
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    guestGuard({ method: 'POST', path: '/api/v1/chat', headers: { authorization: 'Bearer guest_x' } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error.code).toBe('GUEST_WRITE_FORBIDDEN');
    guestGuard({ method: 'GET', path: '/web/x', headers: {} } as any, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('progressive cart merge (FR-4.4, spec §5.7)', () => {
  async function setup(stock = 5) {
    const db = new FakeDb();
    await db.put('scenario_player', 'player-alpha-1', { player_id: 'player-alpha-1' });
    await db.put('scenario_player', 'player-alpha-2', { player_id: 'player-alpha-2' });
    await db.put('variant', 'var-L', { variant_id: 'var-L', price_minor: 450000 });
    db.inventory.set('var-L', { stock, reserved: 0 });
    return { db, svc: new GuestService(db as any) };
  }
  const body = { guest_token: 'guest_anon_tok_7721', registered_user_id: 'player-alpha-1', guest_cart: [{ variant_id: 'var-L', quantity: 1 }], test_write_block: true };

  it('sums quantities per variant', () => {
    const out = mergeItems([{ variant_id: 'a', quantity: 1, unit_price_minor: 10 }], [{ variant_id: 'a', quantity: 2 }, { variant_id: 'b', quantity: 1 }], () => 5);
    expect(out).toEqual([{ variant_id: 'a', quantity: 3, unit_price_minor: 10 }, { variant_id: 'b', quantity: 1, unit_price_minor: 5 }]);
  });

  it('merges once, replays idempotently, refuses reuse, and checks stock', async () => {
    process.env.DAY2_SALT = 'unit-salt';
    const { svc } = await setup();
    const a = await svc.merge(body);
    expect([a.write_rejection_code, a.write_block_verified, a.active_cart.total_items, a.active_cart.subtotal_minor]).toEqual([403, true, 1, 450000]);
    expect(await svc.merge(body)).toEqual(a);
    expect(await code(svc.merge({ ...body, registered_user_id: 'player-alpha-2' }))).toBe('GUEST_TOKEN_ALREADY_MERGED');
    expect(await code(svc.merge({ ...body, guest_token: 'guest_2', guest_cart: [{ variant_id: 'var-L', quantity: 9 }] }))).toBe('OUT_OF_STOCK');
    expect(await code(svc.merge({ ...body, guest_token: 'guest_3', guest_cart: [{ variant_id: 'nope', quantity: 1 }] }))).toBe('VARIANT_NOT_FOUND');
    expect(await code(svc.merge({ ...body, registered_user_id: 'ghost' }))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.merge({ ...body, guest_token: 'anon' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.merge({ ...body, test_write_block: 'y' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.merge(null))).toBe('VALIDATION_ERROR');
    const nb = await svc.merge({ ...body, guest_token: 'guest_4', test_write_block: false });
    expect([nb.write_block_verified, nb.write_rejection_code, nb.active_cart.total_items]).toEqual([false, 0, 2]);
  });

  it('issues guest tokens and stages a guest cart', async () => {
    const { svc } = await setup();
    const t = await svc.issueToken();
    expect(t.guest_token).toMatch(/^guest_anon_tok_[a-f0-9]{12}$/);
    expect((await svc.stage(t.guest_token, { variant_id: 'var-L' })).count).toBe(1);
    expect((await svc.stage(t.guest_token, { variant_id: 'var-L', quantity: 2 })).count).toBe(3);
    expect((await svc.guestCart(t.guest_token)).count).toBe(3);
    expect((await svc.guestCart('guest_none')).count).toBe(0);
    expect(await code(svc.stage(null, { variant_id: 'var-L' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.stage(t.guest_token, { variant_id: 'nope' }))).toBe('VARIANT_NOT_FOUND');
    expect(await code(svc.stage(t.guest_token, { variant_id: 'var-L', quantity: 0 }))).toBe('VALIDATION_ERROR');
  });
});
