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

import { dropParticipant, inviteToken, resign, verifyInvite } from './costream.js';

describe('co-stream host tools (FR-3.3)', () => {
  const host: any = { sub: 'u-host', role: 'player', player_id: 'player-alpha-1', tenant_id: 'tenant-alpha', league_ids: [], club_id: null };
  const other: any = { ...host, sub: 'u-2', player_id: 'player-beta-1' };
  const admin: any = { ...host, role: 'super_admin', player_id: null };

  it('signs and verifies invite tokens, rejecting forgery, expiry and other sessions', () => {
    process.env.DAY2_SALT = 'unit-salt';
    const t = inviteToken('s1', 'p9', Date.now() + 1000);
    expect(verifyInvite(t, 's1')).toBe('p9');
    expect(() => verifyInvite(t, 's2')).toThrow(ApiError);
    expect(() => verifyInvite(t.slice(0, -3) + 'abc', 's1')).toThrow(ApiError);
    expect(() => verifyInvite(inviteToken('s1', 'p9', Date.now() - 1), 's1')).toThrow(ApiError);
    expect(() => verifyInvite('nope', 's1')).toThrow(ApiError);
    expect(() => verifyInvite('%%%.x', 's1')).toThrow(ApiError);
    expect(() => verifyInvite(42, 's1')).toThrow(ApiError);
  });

  it('drops participants deterministically and re-signs', () => {
    const body = resign({ session_id: 's', status: 'active', active_host: 'a', handoff_occurred: false, layout: 'grid_4', active_participants: ['a', 'b', 'c'], muted: ['b'], spotlight: 'b' });
    dropParticipant(body, 'b');
    expect([body.active_participants, body.muted, body.spotlight, body.participant_count]).toEqual([['a', 'c'], [], null, 2]);
    dropParticipant(body, 'a');
    expect([body.active_host, body.handoff_occurred]).toEqual(['c', true]);
    dropParticipant(body, 'c');
    expect([body.status, body.active_host]).toEqual(['terminated', null]);
  });

  async function svcWithSession(participants = ['player-alpha-1', 'player-alpha-2']) {
    const db = new FakeDb();
    for (const p of [...four, 'player-x']) await db.put('scenario_player', p, { player_id: p });
    const svc = new CostreamService(db as any, { bus: new EventEmitter(), emit: async () => undefined } as any);
    await svc.open({ session_id: 'cs', host_player_id: 'player-alpha-1', participants });
    return svc;
  }

  it('host invites, players join up to 4, host mutes/spotlights/kicks', async () => {
    const svc = await svcWithSession();
    const inv = await svc.invite(host, 'cs', { player_id: 'player-beta-1' });
    expect(await code(svc.invite(other, 'cs', { player_id: 'player-beta-2' }))).toBe('FORBIDDEN');
    expect(await code(svc.invite(host, 'cs', { player_id: 'ghost' }))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.invite(host, 'cs', {}))).toBe('VALIDATION_ERROR');
    expect(await code(svc.invite(host, 'nope', { player_id: 'player-beta-1' }))).toBe('STREAM_NOT_FOUND');
    expect((await svc.join('cs', inv)).participant_count).toBe(3);
    expect((await svc.join('cs', inv)).participant_count).toBe(3); // idempotent
    await svc.join('cs', await svc.invite(admin, 'cs', { player_id: 'player-beta-2' }));
    expect(await code(svc.join('cs', await svc.invite(host, 'cs', { player_id: 'player-x' })))).toBe('COSTREAM_SESSION_FULL');
    expect((await svc.control(host, 'cs', { action: 'mute', participant_id: 'player-beta-1' })).muted).toEqual(['player-beta-1']);
    expect((await svc.control(host, 'cs', { action: 'mute', participant_id: 'player-beta-1' })).muted).toEqual(['player-beta-1']);
    expect((await svc.control(host, 'cs', { action: 'unmute', participant_id: 'player-beta-1' })).muted).toEqual([]);
    expect((await svc.control(host, 'cs', { action: 'spotlight', participant_id: 'player-beta-2' })).layout).toBe('spotlight');
    expect((await svc.control(host, 'cs', { action: 'kick', participant_id: 'player-beta-2' })).participant_count).toBe(3);
    expect(await code(svc.control(host, 'cs', { action: 'kick', participant_id: 'player-alpha-1' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.control(host, 'cs', { action: 'mute', participant_id: 'ghost' }))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.control(host, 'cs', { action: 'dance', participant_id: 'player-beta-1' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.control(other, 'cs', { action: 'mute', participant_id: 'player-alpha-2' }))).toBe('FORBIDDEN');
  });

  it('hands over on host disconnect and re-activates a terminated session on join', async () => {
    const svc = await svcWithSession(['player-alpha-1']);
    expect(await svc.disconnect('cs', 'ghost')).toBeNull();
    expect(await svc.disconnect('nope', 'player-alpha-1')).toBeNull();
    const t = await svc.disconnect('cs', 'player-alpha-1');
    expect([t.status, t.active_host]).toEqual(['terminated', null]);
    const back = await svc.join('cs', await svc.invite(admin, 'cs', { player_id: 'player-alpha-2' }));
    expect([back.status, back.active_host]).toEqual(['active', 'player-alpha-2']);
  });
});
