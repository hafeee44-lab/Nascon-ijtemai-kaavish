import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, notFound } from '../common/api-error.js';
import { nowIso } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvent, DomainEvents } from '../queue/domain-events.js';
import { AuthService } from '../rbac/auth.service.js';
import { can } from '../rbac/policy.js';
import { allowedNext, OrderState, transition } from '../store/order-status.js';

const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You are not allowed to perform this action.', {});

// Realtime layer (SSE) plus the write paths that feed it: product pinning and order status.
@Controller('api/v1')
export class RealtimeController {
  constructor(private readonly db: Db, private readonly events: DomainEvents, private readonly auth: AuthService) {}

  // Server-Sent Events: GET /api/v1/stream?token=…&match_id=… (EventSource cannot send headers).
  @Get('stream')
  stream(@Query('token') token: string | undefined, @Query('match_id') matchId: string | undefined, @Headers('authorization') authz: string, @Req() req: Request, @Res() res: Response) {
    this.auth.verify(authz ?? (token ? `Bearer ${token}` : undefined));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: ready\ndata: {"at":"${nowIso()}"}\n\n`);
    const onEvent = (e: DomainEvent) => {
      if (matchId && e.data.match_id !== matchId) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify({ ...e.data, at: e.at })}\n\n`);
    };
    const ping = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    this.events.bus.on('event', onEvent);
    req.on('close', () => {
      clearInterval(ping);
      this.events.bus.off('event', onEvent);
    });
  }

  // FR-2.3: pinning a product on a match page updates connected clients in real time.
  @Post('matches/:id/pin')
  @HttpCode(200)
  async pin(@Headers('authorization') authz: string, @Param('id') id: string, @Body() b: any) {
    const me = this.auth.verify(authz);
    const match = await this.db.get('match', id);
    if (!match) throw notFound('MATCH_NOT_FOUND', `Match ${id} does not exist.`, { match_id: id });
    const product = await this.db.get('product', b?.product_id);
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'That product does not exist.', { product_id: b?.product_id ?? null });
    if (!can(me, 'club.products.write', { tenant_id: product.tenant_id, club_id: product.club_id }) && !(match.league_id && can(me, 'league.fixtures.write', { tenant_id: product.tenant_id, league_id: match.league_id })))
      throw forbidden();
    await this.db.put('match', id, { ...match, pinned_product_id: product.product_id });
    await this.events.emit('match.product_pinned', { match_id: id, product_id: product.product_id });
    return { match_id: id, pinned_product_id: product.product_id };
  }

  @Get('orders/:id')
  async order(@Headers('authorization') authz: string, @Param('id') id: string) {
    this.auth.verify(authz);
    const o = await this.db.get('order', id);
    if (!o || o.status !== 201) throw notFound('ORDER_NOT_FOUND', `Order ${id} does not exist.`, { order_id: id });
    return { ...o.body, allowed_next: allowedNext(o.body.status as OrderState), history: o.history ?? [] };
  }

  // FR-2.3 order lifecycle (club manager of the selling club, or super admin).
  @Patch('orders/:id/status')
  async setStatus(@Headers('authorization') authz: string, @Param('id') id: string, @Body() b: any) {
    const me = this.auth.verify(authz);
    return this.db.tx(async (c) => {
      const o = await this.db.getForUpdate(c, 'order', id);
      if (!o || o.status !== 201) throw notFound('ORDER_NOT_FOUND', `Order ${id} does not exist.`, { order_id: id });
      const variant = await this.db.get('variant', o.body.items[0].variant_id, c);
      const product = variant ? await this.db.get('product', variant.product_id, c) : null;
      if (!can(me, 'club.products.write', { tenant_id: product?.tenant_id ?? null, club_id: product?.club_id })) throw forbidden();
      const from = o.body.status as OrderState;
      const t = transition(from, b?.status);
      if (t.restock)
        for (const i of o.body.items)
          await c.query('UPDATE inventory SET stock = stock + $2 WHERE variant_id = $1', [i.variant_id, i.quantity]);
      o.body.status = t.to;
      if (t.to === 'refunded') o.body.payment = { ...o.body.payment, state: 'refunded' };
      o.history = [...(o.history ?? []), { from, to: t.to, by: me.sub, at: nowIso() }];
      await this.db.put('order', id, o, c);
      await this.events.emit('order.status_changed', { order_id: id, from, to: t.to });
      return { order_id: id, status: t.to, allowed_next: allowedNext(t.to), history: o.history };
    });
  }
}
