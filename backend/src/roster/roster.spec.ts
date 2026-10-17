import { ApiError } from '../common/api-error.js';
import { BASE_SPORTS } from '../db/seed.js';
import { FakeDb } from '../test/fake-db.js';
import { onLoan, RosterService, squadOn } from './roster.service.js';

const scenario = {
  league: { league_id: 'lg', tenant_id: 'ta', sport_id: 'football', transfer_window: { open: '2026-09-01', close: '2026-09-30' }, max_squad_size: 3, required_positions: { gk: 1 } },
  squads: [{ squad_id: 'a', club_id: 'ca', tenant_id: 'ta', name: 'A' }, { squad_id: 'b', club_id: 'cb', tenant_id: 'ta', name: 'B' }, { squad_id: 'x', club_id: 'cx', tenant_id: 'tb', name: 'X' }],
  players: [{ player_id: 'p1', name: 'Ali', position: 'gk', squad_id: 'a', role: 'captain' }, { player_id: 'p2', name: 'Bilal', position: 'df', squad_id: 'a', role: 'starter' },
    { player_id: 'p3', name: 'Cam', position: 'df', squad_id: 'b' }],
  matches_in_progress: [{ match_id: 'live', home_squad_id: 'a', away_squad_id: 'b' }],
};
const req = (id: string, extra: Record<string, any> = {}) => ({
  request_id: id, league_id: 'lg', player_id: 'p2', type: 'transfer', from_squad_id: 'a', to_squad_id: 'b', effective_date: '2026-09-15',
  loan_end_date: null, reason: 'r', requested_by: 'u', ...extra,
});
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };

async function make() {
  const db = new FakeDb();
  for (const s of BASE_SPORTS) await db.put('sport', s.sport_id, s);
  const svc = new RosterService(db as any);
  expect((await svc.setup(scenario)).squad_counts).toEqual({ a: 2, b: 1, x: 0 });
  return { db, svc };
}

describe('roster rules (checked in spec order)', () => {
  it('rejects in the documented order', async () => {
    const { svc } = await make();
    expect(await code(svc.transfer(req('t', { effective_date: 'nope' })))).toBe('VALIDATION_ERROR');
    expect(await code(svc.transfer(req('t', { type: 'loan', loan_end_date: '2026-09-01' })))).toBe('VALIDATION_ERROR');
    expect(await code(svc.transfer(req('t', { league_id: 'zz' })))).toBe('LEAGUE_NOT_FOUND');
    expect(await code(svc.transfer(req('t', { player_id: 'zz' })))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.transfer(req('t', { to_squad_id: 'zz' })))).toBe('SQUAD_NOT_FOUND');
    expect(await code(svc.transfer(req('t', { to_squad_id: 'x' })))).toBe('CROSS_TENANT_TRANSFER');
    expect(await code(svc.transfer(req('t', { from_squad_id: 'b', to_squad_id: 'a' })))).toBe('NOT_IN_SQUAD');
    expect(await code(svc.transfer(req('t', { effective_date: '2026-10-01' })))).toBe('TRANSFER_WINDOW_CLOSED');
    expect(await code(svc.transfer(req('t', { player_id: 'p1' })))).toBe('MIN_POSITION_VIOLATION');
  });

  it('defers a last-day loan during a live match, refuses moving a loaned player, auto-returns once', async () => {
    const { svc, db } = await make();
    const r = await svc.transfer(req('l1', { type: 'loan', effective_date: '2026-09-30', loan_end_date: '2026-12-31' }));
    expect(r.status).toBe(201);
    expect(r.body.state).toBe('deferred_until_match_end');
    expect(r.body.blocking_match_id).toBe('live');
    expect(r.body.registration).toMatchObject({ squad_id: 'b', parent_squad_id: 'a', registration_type: 'loan', role: 'substitute' });
    expect((await svc.transfer(req('l1', { type: 'loan', effective_date: '2026-09-30', loan_end_date: '2026-12-31' }))).status).toBe(200);
    expect(await code(svc.transfer(req('l1')))).toBe('DUPLICATE_REQUEST_ID');
    expect(await code(svc.transfer(req('l2', { from_squad_id: 'b', to_squad_id: 'a', effective_date: '2026-09-30' })))).toBe('PLAYER_ON_LOAN');
    const during = await svc.history('p2', '2026-10-15');
    expect([during.current_squad_id, during.parent_squad_id]).toEqual(['b', 'a']);
    await svc.history('p2', '2027-01-05');
    const after = await svc.history('p2', '2027-01-05');
    expect(after.history.map((h: any) => h.action)).toEqual(['loan', 'loan_return']);
    expect(after.current_squad_id).toBe('a');
    expect(await svc.auditCount('p2', db as any)).toBe(2);
    expect(await code(svc.history('zz'))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.history('p2', 'bad'))).toBe('VALIDATION_ERROR');
  });

  it('enforces squad size and supports release on any date', async () => {
    const { svc } = await make();
    await svc.transfer(req('t1', { player_id: 'p2', to_squad_id: 'b' }));
    await svc.setup({ ...scenario, league: { ...scenario.league, max_squad_size: 1 } });
    expect(await code(svc.transfer(req('t2')))).toBe('SQUAD_FULL');
    const rel = await svc.transfer(req('t3', { type: 'release', to_squad_id: null, effective_date: '2027-03-01' }));
    expect(rel.body.registration).toBeNull();
    expect((await svc.history('p2', '2027-03-02')).current_squad_id).toBeNull();
  });

  it('computes squad membership and loan status by date', () => {
    const reg = { player_id: 'p', league_id: 'l', squad_id: 'b', parent_squad_id: 'a', registration_type: 'loan', start_date: '2026-01-01', loan_end_date: '2026-02-01', role: 'substitute' };
    expect([squadOn(reg, '2026-01-15'), squadOn(reg, '2026-02-02'), onLoan(reg, '2026-02-01'), onLoan(reg, '2026-02-02')]).toEqual(['b', 'a', true, false]);
  });

  it('validates setup payloads', async () => {
    const { svc } = await make();
    expect(await code(svc.setup({}))).toBe('VALIDATION_ERROR');
    expect(await code(svc.setup({ ...scenario, league: { ...scenario.league, sport_id: 'nope' } }))).toBe('SPORT_NOT_FOUND');
    expect(await code(svc.setup({ ...scenario, players: [{ player_id: 'p9', position: 'gk', squad_id: 'zz' }] }))).toBe('SQUAD_NOT_FOUND');
  });
});
