import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { notFound } from '../common/api-error.js';
import { signDay2 } from '../common/canonical.js';
import { BASE } from '../db/day2-seed.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';
import { playerExists } from '../streaming/players.js';

export type EntityType = 'match' | 'player' | 'club' | 'costream';

/** FR-4.1: the route a QR resolves to depends on the entity's live state, never on the printed code. */
export function targetRoute(type: EntityType, id: string, status: string): string {
  if (type === 'player') return `/web/players/${id}`;
  if (type === 'club') return `/web/clubs/${id}`;
  if (type === 'costream') return `/web/costream/${id}`;
  if (status === 'upcoming') return `/web/matches/${id}/preview`;
  if (status === 'in_progress') return `/web/matches/${id}/live`;
  if (status === 'completed') return `/web/matches/${id}/vod`;
  return `/web/matches/${id}/notice?state=${status}`;
}

/** NFR-9: only a coarse device family is kept — never the UA string, IP or cookies. */
export const deviceFamily = (ua: string | undefined) => (/mobi|android|iphone|ipad|ipod/i.test(ua ?? '') ? 'mobile' : 'desktop');
export const hourBucket = (d = new Date()) => d.toISOString().slice(0, 13) + ':00Z';
export const shortCodeFor = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 8);

@Injectable()
export class QrService {
  // Resolution cache (k6 hammers ?inspect=true); invalidated on any match event or reset.
  private cache = new Map<string, any>();

  constructor(private readonly db: Db, private readonly events: EventsService, domain: DomainEvents) {
    domain.bus.on('event', (e) => {
      if (e.type.startsWith('match.') || e.type.startsWith('costream.') || e.type === 'system.reset') this.cache.clear();
    });
  }

  clearCache() {
    this.cache.clear();
  }

  async entity(id: string): Promise<{ type: EntityType; status: string } | null> {
    if (id.startsWith('player-')) return (await playerExists(this.db, id)) ? { type: 'player', status: 'active' } : null;
    if (id.startsWith('club-')) return (await this.db.get('club', id)) ? { type: 'club', status: 'active' } : null;
    if (id.startsWith('cs-session-')) {
      const s = await this.db.get('costream', id);
      return s ? { type: 'costream', status: s.body.status } : null;
    }
    const m = await this.events.loadMatch(this.db.pool, id);
    if (!m) return null;
    return { type: 'match', status: project(m.sport, m.match, m.events).status };
  }

  private async mapping(entityId: string) {
    let q = await this.db.get('qr', entityId);
    if (!q) {
      const code = shortCodeFor(entityId);
      await this.db.query(`INSERT INTO docs(kind,id,data) VALUES('qr',$1,$2) ON CONFLICT DO NOTHING`, [entityId, JSON.stringify({ entity_id: entityId, short_code: code, scan_count: 0 })]);
      await this.db.query(`INSERT INTO docs(kind,id,data) VALUES('qr_code',$1,$2) ON CONFLICT DO NOTHING`, [code, JSON.stringify({ short_code: code, entity_id: entityId })]);
      q = await this.db.get('qr', entityId);
    }
    return q;
  }

  private async scan(entityId: string, ua: string | undefined): Promise<number> {
    const r = await this.db.query(
      `UPDATE docs SET data = jsonb_set(data, '{scan_count}', to_jsonb(COALESCE((data->>'scan_count')::int, 0) + 1)) WHERE kind='qr' AND id=$1 RETURNING (data->>'scan_count')::int AS n`,
      [entityId],
    );
    await this.db.query(
      `INSERT INTO qr_telemetry(entity_id, device_family, hour_bucket, scans) VALUES ($1,$2,$3,1)
       ON CONFLICT (entity_id, device_family, hour_bucket) DO UPDATE SET scans = qr_telemetry.scans + 1`,
      [entityId, deviceFamily(ua), hourBucket()],
    );
    return r.rows[0]?.n ?? 0;
  }

  async resolve(entityId: string, opts: { inspect?: boolean; ua?: string } = {}) {
    let base = this.cache.get(entityId);
    if (!base) {
      const e = await this.entity(entityId);
      if (!e) throw notFound('QR_NOT_FOUND', `No QR mapping for ${entityId}.`, { entity_id: entityId });
      const q = await this.mapping(entityId);
      const short_url = `${BASE()}/q/${q.short_code}`;
      const target_route = targetRoute(e.type, entityId, e.status);
      base = {
        entity_id: entityId, entity_type: e.type, entity_status: e.status, short_url, target_route,
        deep_link_uri: `nascon://entity/${entityId}`,
        export_formats: { svg: `${BASE()}/audit/v1/qr/${entityId}/export.svg`, png: `${BASE()}/audit/v1/qr/${entityId}/export.png`, pdf: `${BASE()}/audit/v1/qr/${entityId}/export.pdf` },
        signature: signDay2(entityId, { entity_id: entityId, short_url, target_route }),
      };
      this.cache.set(entityId, base);
    }
    const scan_count = opts.inspect ? ((await this.db.get('qr', entityId))?.scan_count ?? 0) : await this.scan(entityId, opts.ua);
    const { signature, ...rest } = base;
    return { ...rest, scan_count, signature };
  }

  async byShortCode(code: string, ua?: string) {
    const m = await this.db.get('qr_code', code);
    if (!m) throw notFound('QR_NOT_FOUND', `No QR mapping for code ${code}.`, { short_code: code });
    return this.resolve(m.entity_id, { ua });
  }

  async svg(entityId: string) {
    const r = await this.resolve(entityId, { inspect: true });
    return QRCode.toString(r.short_url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  }

  async png(entityId: string): Promise<Buffer> {
    const r = await this.resolve(entityId, { inspect: true });
    return QRCode.toBuffer(r.short_url, { type: 'png', margin: 2, width: 512, errorCorrectionLevel: 'M' });
  }

  async pdf(entityId: string): Promise<Buffer> {
    const r = await this.resolve(entityId, { inspect: true });
    const png = await QRCode.toBuffer(r.short_url, { type: 'png', margin: 2, width: 600, errorCorrectionLevel: 'H' });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(26).text('Scan to watch on NaSCon', { align: 'center' });
      doc.moveDown(0.5).fontSize(14).text(entityId, { align: 'center' });
      doc.image(png, 97, 170, { width: 400 });
      doc.fontSize(12).text(r.short_url, 50, 600, { align: 'center' });
      doc.end();
    });
  }

  async totalScans() {
    const r = await this.db.query(`SELECT COALESCE(sum((data->>'scan_count')::int),0)::int AS n FROM docs WHERE kind='qr'`);
    return r.rows[0].n as number;
  }
}
