import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { conflict, notFound, validationError } from '../common/api-error.js';
import { canonical, signDay2 } from '../common/canonical.js';
import { isBool, isInt, isObj, isStr } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { playerExists } from '../streaming/players.js';
import { isGuestWrite } from './guest-guard.js';

export interface CartItem { variant_id: string; quantity: number; unit_price_minor: number }

/** Pure merge: sums quantities per variant, keeps first-seen order. */
export function mergeItems(existing: CartItem[], incoming: { variant_id: string; quantity: number }[], price: (v: string) => number): CartItem[] {
  const out = existing.map((i) => ({ ...i }));
  for (const g of incoming) {
    const hit = out.find((i) => i.variant_id === g.variant_id);
    if (hit) hit.quantity += g.quantity;
    else out.push({ variant_id: g.variant_id, quantity: g.quantity, unit_price_minor: price(g.variant_id) });
  }
  return out;
}

@Injectable()
export class GuestService {
  constructor(private readonly db: Db) {}

  async issueToken() {
    const guest_token = 'guest_anon_tok_' + randomBytes(6).toString('hex');
    await this.db.put('guest_token', guest_token, { guest_token, status: 'valid', role: 'guest', merged: null, linked_user_id: null, created_at: new Date().toISOString() });
    await this.db.put('guest_cart', guest_token, { guest_token, items: [] });
    return { guest_token, role: 'guest', scope: ['stream:read', 'score:subscribe', 'cart:stage'], expires_in: 7200 };
  }

  async stage(token: string | null, b: any) {
    if (!token) throw validationError(['authorization'], 'A guest token is required.');
    if (!isObj(b) || !isStr(b.variant_id) || (b.quantity !== undefined && (!isInt(b.quantity) || b.quantity < 1 || b.quantity > 10)))
      throw validationError(['variant_id', 'quantity']);
    const v = await this.db.get('variant', b.variant_id);
    if (!v) throw notFound('VARIANT_NOT_FOUND', `Variant ${b.variant_id} does not exist.`, { variant_id: b.variant_id });
    return this.db.tx(async (c) => {
      await c.query(`INSERT INTO docs(kind,id,data) VALUES('guest_cart',$1,$2) ON CONFLICT DO NOTHING`, [token, JSON.stringify({ guest_token: token, items: [] })]);
      const cart = await this.db.getForUpdate(c, 'guest_cart', token);
      cart.items = mergeItems(cart.items, [{ variant_id: b.variant_id, quantity: b.quantity ?? 1 }], () => v.price_minor);
      await this.db.put('guest_cart', token, cart, c);
      return { guest_token: token, items: cart.items, count: cart.items.reduce((s: number, i: CartItem) => s + i.quantity, 0) };
    });
  }

  async guestCart(token: string) {
    const cart = (await this.db.get('guest_cart', token)) ?? { items: [] };
    return { guest_token: token, items: cart.items, count: cart.items.reduce((s: number, i: CartItem) => s + i.quantity, 0) };
  }

  // FR-4.4 / spec §5.7: verify the 403 guard, then merge atomically and exactly once per guest token.
  async merge(b: any): Promise<any> {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!isStr(b.guest_token) || !b.guest_token.startsWith('guest_')) bad.push('guest_token');
    if (!isStr(b.registered_user_id) || !b.registered_user_id) bad.push('registered_user_id');
    const gc = b.guest_cart;
    if (!Array.isArray(gc) || gc.length < 1 || gc.length > 10 || !gc.every((i: any) => isObj(i) && isStr(i.variant_id) && isInt(i.quantity) && i.quantity >= 1)) bad.push('guest_cart');
    if (b.test_write_block !== undefined && !isBool(b.test_write_block)) bad.push('test_write_block');
    if (bad.length) throw validationError(bad);
    const request = {
      guest_token: b.guest_token, registered_user_id: b.registered_user_id,
      guest_cart: gc.map((i: any) => ({ variant_id: i.variant_id, quantity: i.quantity })), test_write_block: b.test_write_block ?? true,
    };

    if (!(await playerExists(this.db, request.registered_user_id)))
      throw notFound('PLAYER_NOT_FOUND', `User ${request.registered_user_id} does not exist.`, { registered_user_id: request.registered_user_id });
    const prices = new Map<string, number>();
    for (const i of request.guest_cart) {
      const v = await this.db.get('variant', i.variant_id);
      if (!v) throw notFound('VARIANT_NOT_FOUND', `Variant ${i.variant_id} does not exist.`, { variant_id: i.variant_id });
      prices.set(i.variant_id, v.price_minor);
    }

    return this.db.tx(async (c) => {
      await c.query(`INSERT INTO docs(kind,id,data) VALUES('guest_token',$1,$2) ON CONFLICT DO NOTHING`,
        [request.guest_token, JSON.stringify({ guest_token: request.guest_token, status: 'valid', role: 'guest', merged: null, linked_user_id: null })]);
      const tok = await this.db.getForUpdate(c, 'guest_token', request.guest_token);
      // Edge case 4: an identical replay (dropped ACK, network switch) returns the stored result, never re-adds.
      if (tok.merged) {
        if (canonical(tok.merged.request) === canonical(request)) return tok.merged.body;
        throw conflict('GUEST_TOKEN_ALREADY_MERGED', 'This guest token was already merged.', { guest_token: request.guest_token, registered_user_id: tok.linked_user_id });
      }
      await c.query(`INSERT INTO docs(kind,id,data) VALUES('cart',$1,$2) ON CONFLICT DO NOTHING`, [request.registered_user_id, JSON.stringify({ user_id: request.registered_user_id, items: [] })]);
      const cart = await this.db.getForUpdate(c, 'cart', request.registered_user_id);
      const merged = mergeItems(cart.items ?? [], request.guest_cart, (v) => prices.get(v)!);
      for (const i of merged) {
        const inv = await c.query('SELECT stock FROM inventory WHERE variant_id=$1', [i.variant_id]);
        const stock = inv.rows[0]?.stock ?? 0;
        if (i.quantity > stock) throw conflict('OUT_OF_STOCK', `Only ${stock} of ${i.variant_id} available.`, { variant_id: i.variant_id, available: stock });
      }
      const verified = request.test_write_block ? isGuestWrite('POST', '/api/v1/chat', `Bearer ${request.guest_token}`) !== null : false;
      const write_rejection_code = verified ? 403 : 0;
      const total_items = merged.reduce((s, i) => s + i.quantity, 0);
      const subtotal_minor = merged.reduce((s, i) => s + i.quantity * i.unit_price_minor, 0);
      const body = {
        guest_token: request.guest_token,
        write_block_verified: verified,
        write_rejection_code,
        cart_merged: true,
        active_cart: { user_id: request.registered_user_id, currency: 'PKR', total_items, subtotal_minor, items: merged },
        signature: signDay2(request.guest_token, {
          cart_merged: true, guest_token: request.guest_token, registered_user_id: request.registered_user_id, total_items, write_rejection_code,
        }),
      };
      await this.db.put('cart', request.registered_user_id, { user_id: request.registered_user_id, items: merged }, c);
      await this.db.put('guest_token', request.guest_token, { ...tok, status: 'merged', linked_user_id: request.registered_user_id, merged: { request, body } }, c);
      await this.db.put('guest_cart', request.guest_token, { guest_token: request.guest_token, items: [] }, c);
      return body;
    });
  }
}
