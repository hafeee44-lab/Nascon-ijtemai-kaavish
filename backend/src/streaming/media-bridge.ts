import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import { mediaBitrate } from '../observability/metrics.js';

const api = () => process.env.MEDIAMTX_API_URL?.replace(/\/$/, '') ?? '';

async function mtx(path: string, method = 'GET', timeoutMs = 1500): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(api() + path, { method, signal: ctrl.signal });
    if (!r.ok) throw new Error(`mediamtx ${path} → ${r.status}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

/** Readiness probe used by /health (only when a media server is configured). */
export async function mediaServerReady(): Promise<boolean> {
  if (!api()) return true;
  try {
    await mtx('/v3/paths/list');
    return true;
  } catch {
    return false;
  }
}

// Bridges the API and MediaMTX: severs ingest on key revoke (< 2 s), samples bitrate for /metrics,
// and indexes a VOD entry when a recorded live path goes offline (FR-3.2).
@Injectable()
export class MediaBridge implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private lastBytes = new Map<string, { bytes: number; at: number }>();
  private livePaths = new Set<string>();
  liveCount = 0;

  constructor(private readonly db: Db, private readonly events: DomainEvents) {}

  onModuleInit() {
    if (!api()) return;
    this.events.bus.on('event', (e) => {
      if (e.type === 'stream.key_revoked') void this.kick(String(e.data.stream_key));
    });
    this.timer = setInterval(() => void this.poll(), 2000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async kick(key: string) {
    const path = `live/${key}`;
    for (const kind of ['rtmpconns', 'webrtcsessions', 'rtspsessions']) {
      try {
        const list = await mtx(`/v3/${kind}/list`);
        for (const c of list?.items ?? []) if (c.path === path) await mtx(`/v3/${kind}/kick/${c.id}`, 'POST');
      } catch {
        /* media server unavailable: auth hook still refuses the revoked key on reconnect */
      }
    }
  }

  async poll() {
    try {
      const list = await mtx('/v3/paths/list');
      const now = Date.now();
      let kbps = 0;
      const ready = new Set<string>();
      for (const p of list?.items ?? []) {
        if (!p.ready) continue;
        ready.add(p.name);
        const prev = this.lastBytes.get(p.name);
        if (prev && now > prev.at) kbps += ((p.bytesReceived - prev.bytes) * 8) / (now - prev.at);
        this.lastBytes.set(p.name, { bytes: p.bytesReceived, at: now });
      }
      for (const name of this.livePaths) if (!ready.has(name)) await this.indexVod(name);
      this.livePaths = ready;
      this.liveCount = ready.size;
      mediaBitrate.kbps = Math.max(0, Math.round(kbps));
    } catch {
      this.liveCount = 0;
      mediaBitrate.kbps = 0;
    }
  }

  private async indexVod(path: string) {
    const key = path.split('/').pop() ?? path;
    const owner = await this.db.get('stream_key', key);
    const vod = {
      vod_id: `vod-${key}-${Date.now()}`, path, stream_key: key, player_id: owner?.player_id ?? null,
      recording_dir: `${process.env.RECORDINGS_DIR ?? '/recordings'}/${path}`, ended_at: new Date().toISOString(),
    };
    await this.db.put('vod', vod.vod_id, vod);
    await this.events.emit('stream.vod_indexed', vod);
  }
}
