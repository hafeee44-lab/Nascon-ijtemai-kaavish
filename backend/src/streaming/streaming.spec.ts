import { EventEmitter } from 'node:events';
import { ApiError } from '../common/api-error.js';
import { signDay2 } from '../common/canonical.js';
import { FakeDb } from '../test/fake-db.js';
import { MediaBridge, mediaServerReady } from './media-bridge.js';
import { playerExists } from './players.js';
import { keyView, newStreamKey, StreamKeysService } from './stream-keys.js';

const events = () => {
  const emitted: any[] = [];
  return { emitted, bus: new EventEmitter(), emit: async (type: string, data: any) => { emitted.push({ type, data }); } };
};
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };

async function setup() {
  const db = new FakeDb();
  await db.put('scenario_player', 'player-alpha-1', { player_id: 'player-alpha-1' });
  await db.put('user', 'u@x', { user_id: 'user-1', player_id: 'player-9' });
  const ev = events();
  return { db, ev, svc: new StreamKeysService(db as any, ev as any) };
}

describe('stream keys (FR-3.2, spec §5.4)', () => {
  beforeAll(() => { process.env.DAY2_SALT = 'unit-salt'; });

  it('signs with the 4-key payload and builds ingest/playback URLs', () => {
    const v = keyView({ player_id: 'p', label: 'L', stream_key: 'sk_live_0123456789abcdef', status: 'active' }, 'rotate');
    expect(v.signature).toBe(signDay2('sk_live_0123456789abcdef', { action: 'rotate', player_id: 'p', status: 'active', stream_key: 'sk_live_0123456789abcdef' }));
    expect(v.ingest_endpoints?.webrtc).toBe('http://localhost:8889/live/sk_live_0123456789abcdef/whip');
    expect(keyView({ player_id: 'p', label: 'L', stream_key: 'k', status: 'revoked' }, 'revoke').playback_url).toBeNull();
    expect(newStreamKey()).toMatch(/^sk_live_[a-f0-9]{16}$/);
  });

  it('generate → rotate → revoke lifecycle with status codes and 409/404s', async () => {
    const { svc, ev } = await setup();
    const g = await svc.handle({ action: 'generate', player_id: 'player-alpha-1' });
    expect([g.status, g.body.status, g.body.label]).toEqual([201, 'active', 'default']);
    const r = await svc.handle({ action: 'rotate', player_id: 'player-alpha-1', label: 'OBS', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' });
    expect([r.status, r.body.stream_key]).toEqual([200, 'sk_live_9f83a1b2c3d4e5f6']);
    expect(await code(svc.authorize(g.body.stream_key))).toBe('KEY_REVOKED');
    expect((await svc.authorize('sk_live_9f83a1b2c3d4e5f6')).status).toBe('active');
    expect(await svc.activeCount()).toBe(1);
    const v = await svc.handle({ action: 'revoke', player_id: 'player-alpha-1' });
    expect([v.status, v.body.status, v.body.ingest_endpoints]).toEqual([200, 'revoked', null]);
    expect(ev.emitted.filter((e) => e.type === 'stream.key_revoked').length).toBe(2);
    expect(await code(svc.handle({ action: 'generate', player_id: 'player-alpha-1', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' }))).toBe('KEY_REVOKED');
    expect(await code(svc.authorize('nope'))).toBe('STREAM_NOT_FOUND');
  });

  it('validates input and existence', async () => {
    const { svc } = await setup();
    expect(await code(svc.handle({ action: 'nuke', player_id: 'player-alpha-1' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.handle('x'))).toBe('VALIDATION_ERROR');
    expect(await code(svc.handle({ action: 'generate', player_id: 'player-alpha-1', label: '' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.handle({ action: 'generate', player_id: 'player-alpha-1', stream_key_override: 'bad key!' }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.handle({ action: 'generate', player_id: 'ghost' }))).toBe('PLAYER_NOT_FOUND');
    expect(await code(svc.handle({ action: 'revoke', player_id: 'player-alpha-1' }))).toBe('STREAM_NOT_FOUND');
  });

  it('recognises players from scenario, roster and user records', async () => {
    const { db } = await setup();
    await db.put('roster_player', 'rp-1', { player_id: 'rp-1' });
    expect(await playerExists(db as any, 'player-alpha-1')).toBe(true);
    expect(await playerExists(db as any, 'rp-1')).toBe(true);
    expect(await playerExists(db as any, 'player-9')).toBe(true);
    expect(await playerExists(db as any, 'nobody')).toBe(false);
    expect(await playerExists(db as any, '')).toBe(false);
  });
});

describe('media bridge (MediaMTX integration)', () => {
  afterEach(() => { delete process.env.MEDIAMTX_API_URL; vi.unstubAllGlobals(); });

  it('reports ready when no media server is configured, and probes it when one is', async () => {
    expect(await mediaServerReady()).toBe(true);
    process.env.MEDIAMTX_API_URL = 'http://mtx:9997';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[]}', { status: 200 })));
    expect(await mediaServerReady()).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await mediaServerReady()).toBe(false);
  });

  it('samples bitrate, indexes VOD when a live path ends, and kicks revoked keys', async () => {
    process.env.MEDIAMTX_API_URL = 'http://mtx:9997';
    const db = new FakeDb();
    await db.put('stream_key', 'sk_live_a', { player_id: 'player-alpha-1', stream_key: 'sk_live_a', status: 'active' });
    const ev = events();
    const bridge = new MediaBridge(db as any, ev as any);
    let bytes = 0;
    let live = true;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/v3/paths/list')) {
        bytes += 125_000;
        return new Response(JSON.stringify({ items: live ? [{ name: 'live/sk_live_a', ready: true, bytesReceived: bytes }] : [] }), { status: 200 });
      }
      if (url.endsWith('/v3/rtmpconns/list')) return new Response(JSON.stringify({ items: [{ id: 'c1', path: 'live/sk_live_a' }] }), { status: 200 });
      if (url.includes('/list')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response('', { status: 200 });
    }));
    await bridge.poll();
    await new Promise((r) => setTimeout(r, 20));
    await bridge.poll();
    expect(bridge.liveCount).toBe(1);
    live = false;
    await bridge.poll();
    expect(bridge.liveCount).toBe(0);
    expect(ev.emitted.some((e) => e.type === 'stream.vod_indexed' && e.data.player_id === 'player-alpha-1')).toBe(true);
    await bridge.kick('sk_live_a');
    expect(calls).toContain('POST http://mtx:9997/v3/rtmpconns/kick/c1');
    bridge.onModuleInit();
    ev.bus.emit('event', { type: 'stream.key_revoked', data: { stream_key: 'sk_live_a' } });
    bridge.onModuleDestroy();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await bridge.poll();
    await bridge.kick('sk_live_a');
    expect(bridge.liveCount).toBe(0);
  });
});
