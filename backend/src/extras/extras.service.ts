import { Injectable } from '@nestjs/common';
import { ApiError, notFound, validationError } from '../common/api-error.js';
import { isInt, isObj, isStr, nowIso } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import { can, Principal } from '../rbac/policy.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';

const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You are not allowed to perform this action.', {});

// Phase 6 extras: scheduled prices, athlete profile (FR-3.1), store administration.
@Injectable()
export class ExtrasService {
  constructor(private readonly db: Db, private readonly events: EventsService, private readonly domain: DomainEvents) {}

  private async productOf(variantId: string) {
    const v = await this.db.get('variant', variantId);
    if (!v) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} does not exist.`, { variant_id: variantId });
    return { v, product: await this.db.get('product', v.product_id) };
  }

  async schedulePrice(me: Principal, variantId: string, b: any) {
    if (!isObj(b) || !isInt(b.price_minor) || b.price_minor < 1 || b.price_minor > 100_000_000) throw validationError(['price_minor']);
    const at = b.effective_at === undefined || b.effective_at === null ? new Date() : new Date(b.effective_at);
    if (Number.isNaN(at.getTime())) throw validationError(['effective_at']);
    const { product } = await this.productOf(variantId);
    if (!can(me, 'club.products.write', { tenant_id: product?.tenant_id ?? null, club_id: product?.club_id })) throw forbidden();
    await this.db.query('INSERT INTO variant_prices(variant_id, price_minor, effective_at, created_by) VALUES ($1,$2,$3,$4)', [variantId, b.price_minor, at.toISOString(), me.sub]);
    await this.domain.emit('store.price_scheduled', { variant_id: variantId, price_minor: b.price_minor, effective_at: at.toISOString(), by: me.sub });
    return this.prices(variantId);
  }

  async prices(variantId: string) {
    const { v } = await this.productOf(variantId);
    const r = await this.db.query('SELECT price_minor, effective_at, created_by FROM variant_prices WHERE variant_id=$1 ORDER BY effective_at, seq', [variantId]);
    const now = Date.now();
    const rows = r.rows.map((x: any) => ({ price_minor: x.price_minor, effective_at: new Date(x.effective_at).toISOString(), created_by: x.created_by }));
    const past = rows.filter((x) => Date.parse(x.effective_at) <= now);
    return {
      variant_id: variantId, currency: 'PKR', base_price_minor: v.price_minor,
      current_price_minor: past.length ? past[past.length - 1].price_minor : v.price_minor,
      scheduled: rows.filter((x) => Date.parse(x.effective_at) > now), history: past,
    };
  }

  async inventoryAudit(me: Principal, variantId: string) {
    const { product } = await this.productOf(variantId);
    if (!can(me, 'club.products.write', { tenant_id: product?.tenant_id ?? null, club_id: product?.club_id })) throw forbidden();
    const r = await this.db.query('SELECT variant_id, delta, reason, actor, created_at FROM inventory_audit WHERE variant_id=$1 ORDER BY seq', [variantId]);
    return { variant_id: variantId, entries: r.rows };
  }

  async orders(me: Principal) {
    if (me.role !== 'super_admin' && me.role !== 'club_manager') throw forbidden();
    const docs = await this.db.list('order');
    return {
      orders: docs.filter((o) => o.status === 201).map((o) => ({
        order_id: o.body.order_id, status: o.body.status, total_minor: o.body.total_minor, currency: 'PKR',
        items: o.body.items.length, paid_at: o.body.receipt?.payload?.paid_at ?? null,
      })),
    };
  }

  // FR-3.1 public athlete profile: career record from the event logs, club, fixtures, VOD archive.
  async athlete(id: string) {
    if (!isStr(id)) throw validationError(['id']);
    const p = (await this.db.get('scenario_player', id)) ?? (await this.db.get('roster_player', id));
    if (!p) throw notFound('PLAYER_NOT_FOUND', `Player ${id} does not exist.`, { player_id: id });
    const clubId: string | null = p.club_id ?? null;
    const club = clubId ? await this.db.get('club', clubId) : null;
    const record = { played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0 };
    const upcoming: any[] = [];
    if (clubId) {
      for (const m of await this.db.list('match')) {
        if (m.home_team_id !== clubId && m.away_team_id !== clubId) continue;
        const full = await this.events.loadMatch(this.db.pool, m.match_id);
        if (!full) continue;
        const pr = project(full.sport, full.match, full.events);
        const home = m.home_team_id === clubId;
        const mine = home ? pr.home.score : pr.away.score;
        const theirs = home ? pr.away.score : pr.home.score;
        if (pr.status === 'completed' && pr.outcome !== 'undecided') {
          record.played++;
          record.scored += mine;
          record.conceded += theirs;
          if (pr.winner_team_id === clubId) record.won++;
          else if (pr.outcome === 'draw') record.drawn++;
          else record.lost++;
        } else if (pr.status === 'upcoming' || pr.status === 'in_progress') {
          upcoming.push({ match_id: m.match_id, status: pr.status, opponent: home ? m.away_team_id : m.home_team_id, home, kickoff: m.kickoff ?? null, score: `${pr.home.score} - ${pr.away.score}` });
        }
      }
    }
    const vods = (await this.db.list('vod')).filter((v) => v.player_id === id).map((v) => ({ vod_id: v.vod_id, path: v.path, ended_at: v.ended_at }));
    const followers = (await this.db.query('SELECT count(*)::int AS n FROM follows WHERE athlete_id=$1', [id])).rows[0].n;
    return {
      player_id: id, name: p.name ?? id, position: p.position ?? null, anonymized: !!p.anonymized,
      club: clubId ? { club_id: clubId, name: club?.name ?? clubId } : null,
      career: record, upcoming_fixtures: upcoming, vod_archive: vods, follower_count: followers, generated_at: nowIso(),
    };
  }
}
