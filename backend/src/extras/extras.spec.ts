import { ApiError } from '../common/api-error.js';
import { BASE_SPORTS } from '../db/seed.js';
import { FakeDb } from '../test/fake-db.js';
import { ExtrasService } from './extras.service.js';

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };
const manager: any = { sub: 'u-m', role: 'club_manager', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', league_ids: [], player_id: null };
const viewer: any = { ...manager, role: 'viewer', club_id: null };

async function setup() {
  const db = new FakeDb();
  await db.put('variant', 'v1', { variant_id: 'v1', product_id: 'prod', price_minor: 450000 });
  await db.put('product', 'prod', { product_id: 'prod', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1' });
  await db.put('scenario_player', 'player-alpha-1', { player_id: 'player-alpha-1', club_id: 'club-alpha-1', name: 'Ali' });
  await db.put('scenario_player', 'free-agent', { player_id: 'free-agent' });
  await db.put('club', 'club-alpha-1', { club_id: 'club-alpha-1', name: 'Alpha Lions' });
  const football = BASE_SPORTS.find((s) => s.sport_id === 'football');
  const logs: Record<string, any[]> = {
    m1: [{ seq: 1, event_id: 'a', type: 'match_start', payload: {} }, { seq: 2, event_id: 'b', type: 'score', payload: { team_id: 'club-alpha-1', event_type: 'goal' } }, { seq: 3, event_id: 'c', type: 'match_end', payload: {} }],
    m2: [{ seq: 1, event_id: 'd', type: 'match_start', payload: {} }, { seq: 2, event_id: 'e', type: 'match_end', payload: {} }],
    m3: [{ seq: 1, event_id: 'f', type: 'match_start', payload: {} }, { seq: 2, event_id: 'g', type: 'score', payload: { team_id: 'club-x', event_type: 'goal' } }, { seq: 3, event_id: 'h', type: 'match_end', payload: {} }],
    m4: [],
  };
  for (const [id, home, away] of [['m1', 'club-alpha-1', 'club-x'], ['m2', 'club-x', 'club-alpha-1'], ['m3', 'club-alpha-1', 'club-x'], ['m4', 'club-alpha-1', 'club-x'], ['m5', 'club-y', 'club-x'], ['m6', 'club-alpha-1', 'club-z']])
    await db.put('match', id, { match_id: id, sport_id: 'football', home_team_id: home, away_team_id: away });
  await db.put('vod', 'vod-1', { vod_id: 'vod-1', player_id: 'player-alpha-1', path: 'live/k', ended_at: 't' });
  db.followRows.push({ follower_id: 'u', athlete_id: 'player-alpha-1' });
  const events = { loadMatch: async (_p: unknown, id: string) => (logs[id] ? { match: { match_id: id, home_team_id: id === 'm2' ? 'club-x' : 'club-alpha-1', away_team_id: id === 'm2' ? 'club-alpha-1' : 'club-x' }, sport: football, events: logs[id] } : null) };
  return { db, svc: new ExtrasService(db as any, events as any, { emit: async () => undefined } as any) };
}

describe('extras: pricing, athlete profile, store admin', () => {
  it('schedules prices and reports current vs scheduled', async () => {
    const { svc } = await setup();
    expect((await svc.prices('v1')).current_price_minor).toBe(450000);
    expect((await svc.schedulePrice(manager, 'v1', { price_minor: 400000 })).current_price_minor).toBe(400000);
    const later = await svc.schedulePrice(manager, 'v1', { price_minor: 380000, effective_at: '2099-01-01T00:00:00Z' });
    expect([later.current_price_minor, later.scheduled.length]).toEqual([400000, 1]);
    expect(await code(svc.schedulePrice(viewer, 'v1', { price_minor: 1 }))).toBe('FORBIDDEN');
    expect(await code(svc.schedulePrice(manager, 'v1', { price_minor: 0 }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.schedulePrice(manager, 'v1', { price_minor: 5, effective_at: 'soon' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.prices('nope'))).toBe('VARIANT_NOT_FOUND');
  });

  it('builds the athlete profile from event logs', async () => {
    const { svc } = await setup();
    const p = await svc.athlete('player-alpha-1');
    expect(p.career).toEqual({ played: 3, won: 1, drawn: 1, lost: 1, scored: 1, conceded: 1 });
    expect(p.upcoming_fixtures.map((f: any) => f.match_id)).toEqual(['m4']);
    expect([p.vod_archive.length, p.follower_count, p.club?.name]).toEqual([1, 1, 'Alpha Lions']);
    expect((await svc.athlete('free-agent')).club).toBeNull();
    expect(await code(svc.athlete('ghost'))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.athlete(5 as any))).toBe('VALIDATION_ERROR');
  });

  it('gates restock audit and order lists', async () => {
    const { svc, db } = await setup();
    db.restocks.push({ variant_id: 'v1', delta: 3 });
    await db.put('order', 'o1', { status: 201, body: { order_id: 'o1', status: 'paid', total_minor: 1, items: [{}], receipt: { payload: { paid_at: 't' } } } });
    await db.put('order', 'o2', { status: 402, body: {} });
    expect((await svc.inventoryAudit(manager, 'v1')).entries).toHaveLength(1);
    expect(await code(svc.inventoryAudit(viewer, 'v1'))).toBe('FORBIDDEN');
    expect((await svc.orders(manager)).orders.map((o: any) => o.order_id)).toEqual(['o1']);
    expect(await code(svc.orders(viewer))).toBe('FORBIDDEN');
  });
});
