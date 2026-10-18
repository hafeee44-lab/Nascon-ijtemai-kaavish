import { EventEmitter } from 'node:events';
import { ApiError } from '../common/api-error.js';
import { FakeDb } from '../test/fake-db.js';
import { CostreamService, resolveSession } from './costream.js';

const four = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };

describe('co-stream state machine (FR-3.3, spec §5.5)', () => {
  it('hands over to participants[1] when the host drops', () => {
    const b = resolveSession({ session_id: 's', host_player_id: four[0], participants: four, layout: 'grid_4', simulate_host_drop: true });
    expect([b.active_host, b.handoff_occurred, b.participant_count, b.status]).toEqual(['player-alpha-2', true, 3, 'active']);
    expect(b.chat_room_id).toBe('chat-s');
  });
  it('keeps the host when nobody drops and terminates a lone dropped host', () => {
    expect(resolveSession({ session_id: 's', host_player_id: four[0], participants: four, layout: 'spotlight', simulate_host_drop: false }).participant_count).toBe(4);
    const t = resolveSession({ session_id: 's', host_player_id: four[0], participants: [four[0]], layout: 'solo', simulate_host_drop: true });
    expect([t.status, t.active_host, t.participant_count]).toEqual(['terminated', null, 0]);
  });
  it('rejects >4 participants and layouts that cannot fit', () => {
    expect(() => resolveSession({ session_id: 's', host_player_id: 'a', participants: ['a', 'b', 'c', 'd', 'e'], layout: 'grid_4', simulate_host_drop: false })).toThrow(ApiError);
    expect(() => resolveSession({ session_id: 's', host_player_id: 'a', participants: ['a', 'b'], layout: 'solo', simulate_host_drop: false })).toThrow(ApiError);
    expect(() => resolveSession({ session_id: 's', host_player_id: 'a', participants: ['a', 'b', 'c'], layout: 'grid_2', simulate_host_drop: false })).toThrow(ApiError);
    expect(resolveSession({ session_id: 's', host_player_id: 'a', participants: ['a', 'b', 'c'], layout: 'grid_2', simulate_host_drop: true }).participant_count).toBe(2);
  });
});

describe('co-stream service', () => {
  async function setup() {
    const db = new FakeDb();
    for (const p of four) await db.put('scenario_player', p, { player_id: p });
    return new CostreamService(db as any, { bus: new EventEmitter(), emit: async () => undefined } as any);
  }
  it('creates (201), replays identically (200) and validates in spec order', async () => {
    const svc = await setup();
    const body = { session_id: 'cs-session-101', host_player_id: four[0], participants: four, simulate_host_drop: true };
    const a = await svc.open(body);
    const b = await svc.open(body);
    expect([a.status, b.status, b.body]).toEqual([201, 200, a.body]);
    expect((await svc.get('cs-session-101'))?.body.layout).toBe('grid_4');
    expect(await code(svc.open({ ...body, participants: [...four, 'ghost'] }))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.open({ ...body, host_player_id: 'player-beta-2', participants: [four[0]] }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.open({ ...body, participants: [] }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.open({ ...body, layout: 'mosaic' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.open({ ...body, simulate_host_drop: 'yes' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.open(null))).toBe('VALIDATION_ERROR');
  });
});
