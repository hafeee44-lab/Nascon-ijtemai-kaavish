import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, notFound, validationError } from '../common/api-error.js';
import { isInt, isObj, isStr, nowIso } from '../common/validate.js';
import { CostreamService } from '../costream/costream.js';
import { Db } from '../db/db.service.js';
import { ModerationService } from '../moderation_dlq/moderation.service.js';
import { live, mediaBitrate, renderMetrics } from '../observability/metrics.js';
import { guestTokenOf } from '../qr_guest/guest-guard.js';
import { GuestService } from '../qr_guest/guest.js';
import { QrService } from '../qr_guest/qr.js';
import { DomainEvent, DomainEvents } from '../queue/domain-events.js';
import { AuthService } from '../rbac/auth.service.js';
import { can } from '../rbac/policy.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';
import { playerExists } from '../streaming/players.js';
import { StreamKeysService } from '../streaming/stream-keys.js';

const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You are not allowed to perform this action.', {});

@Controller()
export class Day2Controller {
  constructor(
    private readonly db: Db, private readonly keys: StreamKeysService, private readonly costream: CostreamService,
    private readonly qr: QrService, private readonly guest: GuestService, private readonly mod: ModerationService,
    private readonly domain: DomainEvents, private readonly auth: AuthService, private readonly events: EventsService,
  ) {}

  // ---------- §5.4 stream keys ----------
  @Post('audit/v1/stream/key')
  async streamKey(@Body() b: any, @Res() res: Response) {
    const r = await this.keys.handle(b);
    res.status(r.status).json(r.body);
  }

  // MediaMTX external auth hook: publish/read allowed only for active keys (revoked → 409 KEY_REVOKED).
  @Post('internal/media/auth')
  @HttpCode(200)
  async mediaAuth(@Body() b: any) {
    const path: string = b?.path ?? '';
    const key = path.split('/').pop() ?? '';
    if (path.startsWith('costream/')) return { ok: true };
    return this.keys.authorize(key);
  }

  @Get('api/v1/streams/:key')
  streamStatus(@Param('key') key: string) {
    return this.keys.authorize(key);
  }

  // ---------- §5.5 co-stream ----------
  @Post('audit/v1/costream/session')
  async costreamSession(@Body() b: any, @Res() res: Response) {
    const r = await this.costream.open(b);
    res.status(r.status).json(r.body);
  }

  @Get('api/v1/costream/:id')
  async costreamGet(@Param('id') id: string) {
    const s = await this.costream.get(id);
    if (!s) throw notFound('STREAM_NOT_FOUND', `Co-stream ${id} does not exist.`, { session_id: id });
    return s.body;
  }

  // ---------- §5.6 QR ----------
  @Get('audit/v1/qr/:entityId/export.:fmt')
  async qrExport(@Param('entityId') id: string, @Param('fmt') fmt: string, @Res() res: Response) {
    if (fmt === 'svg') return res.status(200).type('image/svg+xml').send(await this.qr.svg(id));
    if (fmt === 'png') return res.status(200).type('image/png').send(await this.qr.png(id));
    if (fmt === 'pdf') return res.status(200).type('application/pdf').send(await this.qr.pdf(id));
    throw validationError(['fmt'], 'Export format must be svg, png or pdf.');
  }

  @Get('audit/v1/qr/:entityId')
  qrResolve(@Param('entityId') id: string, @Query('inspect') inspect: string | undefined, @Headers('user-agent') ua: string) {
    return this.qr.resolve(id, { inspect: inspect === 'true' || inspect === '1', ua });
  }

  @Get('q/:code')
  async shortLink(@Param('code') code: string, @Headers('user-agent') ua: string, @Res() res: Response) {
    const r = await this.qr.byShortCode(code, ua);
    res.redirect(302, r.target_route);
  }

  // ---------- §5.7 guest access + cart merge ----------
  @Post('api/v1/guest/token')
  @HttpCode(201)
  guestToken() {
    return this.guest.issueToken();
  }

  @Post('api/v1/guest/cart')
  @HttpCode(200)
  guestStage(@Headers('authorization') authz: string, @Body() b: any) {
    return this.guest.stage(guestTokenOf(authz), b);
  }

  @Get('api/v1/guest/cart')
  guestCart(@Headers('authorization') authz: string) {
    const t = guestTokenOf(authz);
    if (!t) throw validationError(['authorization']);
    return this.guest.guestCart(t);
  }

  @Post('audit/v1/guest/cart-merge')
  @HttpCode(200)
  cartMerge(@Body() b: any) {
    return this.guest.merge(b);
  }

  // Member login from the guest web player, then merge the staged cart (progressive registration).
  @Post('api/v1/guest/upgrade')
  @HttpCode(200)
  async upgrade(@Body() b: any) {
    const session = await this.auth.login(b?.email, b?.password);
    const token = isStr(b?.guest_token) ? b.guest_token : null;
    const staged = token ? (await this.db.get('guest_cart', token))?.items ?? [] : [];
    const userId = session.user.player_id ?? session.user.user_id;
    let merge = null;
    if (token && staged.length && (await playerExists(this.db, userId)))
      merge = await this.guest.merge({ guest_token: token, registered_user_id: userId, guest_cart: staged.map((i: any) => ({ variant_id: i.variant_id, quantity: i.quantity })), test_write_block: true });
    return { ...session, merge };
  }

  // ---------- §5.8 moderation, chat, DLQ ----------
  @Post('audit/v1/moderation/test')
  @HttpCode(200)
  moderation(@Body() b: any) {
    return this.mod.test(b);
  }

  @Post('api/v1/chat')
  @HttpCode(201)
  chat(@Headers('authorization') authz: string, @Body() b: any) {
    const me = this.auth.verify(authz);
    return this.mod.post(me.sub, b);
  }

  @Get('api/v1/chat/:room')
  chatHistory(@Param('room') room: string) {
    return this.mod.history(room);
  }

  // ---------- §5.9 observability + privacy ----------
  @Get('metrics')
  async metrics(@Res() res: Response) {
    const [streams, dlq, scans] = await Promise.all([this.keys.activeCount(), this.mod.depth(), this.qr.totalScans()]);
    const body = renderMetrics([
      { name: 'nascon_active_ws_connections', help: 'Open WebSocket/SSE subscriber connections.', type: 'gauge', value: live.connections },
      { name: 'nascon_active_streams_total', help: 'Active creator stream keys.', type: 'gauge', value: streams },
      { name: 'nascon_stream_bitrate_kbps', help: 'Aggregate ingest bitrate reported by the media server.', type: 'gauge', value: mediaBitrate.kbps },
      { name: 'nascon_dlq_depth', help: 'Notifications waiting in the dead-letter queue.', type: 'gauge', value: dlq },
      { name: 'nascon_qr_scans_total', help: 'Total dynamic QR scans.', type: 'counter', value: scans },
      { name: 'nascon_http_requests_total', help: 'HTTP requests served.', type: 'counter', value: live.httpRequests },
    ]);
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(body);
  }

  @Delete('audit/v1/privacy/user/:userId')
  async erase(@Param('userId') userId: string) {
    if (!(await playerExists(this.db, userId))) throw notFound('PLAYER_NOT_FOUND', `User ${userId} does not exist.`, { user_id: userId });
    await this.db.tx(async (c) => {
      const p = await this.db.get('scenario_player', userId, c);
      if (p) await this.db.put('scenario_player', userId, { ...p, name: 'Anonymized user', email: null, phone: null, anonymized: true }, c);
      await c.query(`UPDATE docs SET data = data || jsonb_build_object('status','revoked','linked_user_id',null) WHERE kind='guest_token' AND data->>'linked_user_id'=$1`, [userId]);
      await c.query(`UPDATE chat_messages SET sender='anonymized' WHERE sender=$1`, [userId]);
      await c.query(`DELETE FROM follows WHERE follower_id=$1`, [userId]);
    });
    return { user_id: userId, status: 'anonymized', pii_retained: false, tokens_wiped: true };
  }

  // ---------- NFR-1 realtime (SSE): live score + chat + overlays for one match / room ----------
  @Get('api/v1/matches/:id/stream')
  matchStream(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    this.sse(req, res, (e) => e.data.match_id === id || e.data.chat_room_id === `chat-${id}` || e.type === 'match.product_pinned' && e.data.match_id === id,
      async () => this.scoreSnapshot(id));
  }

  @Get('api/v1/chat/:room/stream')
  chatStream(@Param('room') room: string, @Req() req: Request, @Res() res: Response) {
    this.sse(req, res, (e) => e.type === 'chat.message' && e.data.chat_room_id === room);
  }

  async scoreSnapshot(matchId: string) {
    const m = await this.events.loadMatch(this.db.pool, matchId);
    if (!m) return null;
    const p = project(m.sport, m.match, m.events);
    return { match_id: matchId, status: p.status, home: p.home.team_id, away: p.away.team_id, home_score: p.home.score, away_score: p.away.score, score: `${p.home.score} - ${p.away.score}`, version: p.version };
  }

  private sse(req: Request, res: Response, filter: (e: DomainEvent) => boolean, snapshot?: () => Promise<any>) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    live.connections++;
    const write = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (snapshot) snapshot().then((s) => s && write('score', s)).catch(() => undefined);
    const onEvent = async (e: DomainEvent) => {
      if (!filter(e)) return;
      if (e.type === 'match.event_appended' || e.type === 'match.status_changed') {
        const s = await this.scoreSnapshot(String(e.data.match_id));
        if (s) write('score', s);
      } else write(e.type, { ...e.data, at: e.at });
    };
    const ping = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    this.domain.bus.on('event', onEvent);
    req.on('close', () => {
      clearInterval(ping);
      live.connections--;
      this.domain.bus.off('event', onEvent);
    });
  }

  // ---------- Extras: restock (asked at the Day 1 desk) and follow/unfollow (FR-3.1) ----------
  @Post('api/v1/inventory/:variantId/restock')
  @HttpCode(200)
  async restock(@Headers('authorization') authz: string, @Param('variantId') variantId: string, @Body() b: any) {
    const me = this.auth.verify(authz);
    if (!isObj(b) || !isInt(b.quantity) || b.quantity < 1 || b.quantity > 1000) throw validationError(['quantity']);
    const v = await this.db.get('variant', variantId);
    if (!v) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} does not exist.`, { variant_id: variantId });
    const product = await this.db.get('product', v.product_id);
    if (!can(me, 'club.products.write', { tenant_id: product?.tenant_id ?? null, club_id: product?.club_id })) throw forbidden();
    const r = await this.db.tx(async (c) => {
      const u = await c.query('UPDATE inventory SET stock = stock + $2 WHERE variant_id = $1 RETURNING stock, reserved', [variantId, b.quantity]);
      await c.query('INSERT INTO inventory_audit(variant_id, delta, reason, actor) VALUES ($1,$2,$3,$4)', [variantId, b.quantity, isStr(b.reason) ? b.reason : 'restock', me.sub]);
      return u.rows[0];
    });
    await this.domain.emit('inventory.restocked', { variant_id: variantId, quantity: b.quantity, stock: r.stock, by: me.sub });
    return { variant_id: variantId, stock: r.stock, reserved: r.reserved, restocked_by: me.sub, at: nowIso() };
  }

  @Post('api/v1/athletes/:id/follow')
  @HttpCode(200)
  async follow(@Headers('authorization') authz: string, @Param('id') id: string) {
    const me = this.auth.verify(authz);
    if (!(await playerExists(this.db, id))) throw notFound('PLAYER_NOT_FOUND', `Player ${id} does not exist.`, { player_id: id });
    await this.db.query('INSERT INTO follows(follower_id, athlete_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me.sub, id]);
    return this.followState(me.sub, id);
  }

  @Delete('api/v1/athletes/:id/follow')
  async unfollow(@Headers('authorization') authz: string, @Param('id') id: string) {
    const me = this.auth.verify(authz);
    await this.db.query('DELETE FROM follows WHERE follower_id=$1 AND athlete_id=$2', [me.sub, id]);
    return this.followState(me.sub, id);
  }

  private async followState(me: string, id: string) {
    const n = await this.db.query('SELECT count(*)::int AS n, bool_or(follower_id=$2) AS mine FROM follows WHERE athlete_id=$1', [id, me]);
    return { athlete_id: id, following: !!n.rows[0].mine, follower_count: n.rows[0].n };
  }
}
