import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiError, conflict, notFound, validationError } from '../common/api-error.js';
import { canonical, sign } from '../common/canonical.js';
import { isId, isInt, isObj, isStr, nowIso } from '../common/validate.js';
import { Db } from '../db/db.service.js';
import { DomainEvents } from '../queue/domain-events.js';
import { receiptPdf } from './receipt-pdf.js';

const TOKENS = ['tok_success', 'tok_declined', 'tok_capture_fail'];

export interface CheckoutResult { status: number; body: any }

@Injectable()
export class StoreService {
  constructor(private readonly db: Db, private readonly events: DomainEvents) {}

  validate(b: any) {
    if (!isObj(b)) throw validationError(['body']);
    const bad: string[] = [];
    if (!isId(b.order_id)) bad.push('order_id');
    if (!isStr(b.customer_id) || b.customer_id.length < 1 || b.customer_id.length > 256) bad.push('customer_id');
    const items = b.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 10 ||
      !items.every((i: any) => isObj(i) && isId(i.variant_id) && isInt(i.quantity) && i.quantity >= 1 && i.quantity <= 10) ||
      new Set(items.map((i: any) => i.variant_id)).size !== items.length)
      bad.push('items');
    if (b.discount_code !== undefined && b.discount_code !== null && !isStr(b.discount_code)) bad.push('discount_code');
    if (!isObj(b.payment) || !TOKENS.includes(b.payment.token)) bad.push('payment');
    if (bad.length) throw validationError(bad);
  }

  // Spec 5.12 / NFR-3: atomic reservation means 20 buyers on the last unit yield exactly one sale.
  async checkout(b: any): Promise<CheckoutResult> {
    this.validate(b);
    const request = {
      order_id: b.order_id, customer_id: b.customer_id,
      items: b.items.map((i: any) => ({ variant_id: i.variant_id, quantity: i.quantity })),
      discount_code: b.discount_code ?? null, payment: { token: b.payment.token },
    };
    const prices = new Map<string, number>();
    for (const i of request.items) {
      const v = await this.db.get('variant', i.variant_id);
      if (!v) throw notFound('VARIANT_NOT_FOUND', `Variant ${i.variant_id} does not exist.`, { variant_id: i.variant_id });
      prices.set(i.variant_id, v.price_minor);
    }
    let percent = 0;
    if (request.discount_code !== null) {
      const d = await this.db.get('discount', request.discount_code);
      if (!d) throw new ApiError(400, 'INVALID_DISCOUNT_CODE', `Discount code ${request.discount_code} is not valid.`, { discount_code: request.discount_code });
      percent = d.percent;
    }
    const prior = await this.replay(request);
    if (prior) return prior;

    // Claim the order id first so concurrent replays of the same id cannot double-reserve.
    const claim = await this.db.query(
      `INSERT INTO docs(kind,id,data) VALUES('order',$1,$2) ON CONFLICT DO NOTHING RETURNING id`,
      [request.order_id, JSON.stringify({ request, state: 'pending' })],
    );
    if (!claim.rowCount) {
      const again = await this.replay(request, true);
      if (again) return again;
    }

    const items = [...request.items].sort((a, b) => (a.variant_id < b.variant_id ? -1 : 1));
    try {
      await this.db.tx(async (c) => {
        for (const i of items) {
          const r = await c.query(
            'UPDATE inventory SET stock = stock - $2, reserved = reserved + $2 WHERE variant_id = $1 AND stock >= $2 RETURNING stock',
            [i.variant_id, i.quantity],
          );
          if (!r.rowCount) throw conflict('OUT_OF_STOCK', `Variant ${i.variant_id} has no stock left.`, { variant_id: i.variant_id });
        }
      });
    } catch (e) {
      await this.db.query(`DELETE FROM docs WHERE kind='order' AND id=$1`, [request.order_id]);
      throw e;
    }

    const release = async () => {
      await this.db.tx(async (c) => {
        for (const i of items)
          await c.query('UPDATE inventory SET stock = stock + $2, reserved = reserved - $2 WHERE variant_id = $1', [i.variant_id, i.quantity]);
      });
    };

    // Mock payment gateway: authorize, then capture.
    const token = request.payment.token;
    if (token !== 'tok_success') {
      await release();
      const code = token === 'tok_declined' ? 'PAYMENT_DECLINED' : 'PAYMENT_CAPTURE_FAILED';
      const body = { error: { code, message: token === 'tok_declined' ? 'The payment was declined.' : 'The payment could not be captured.', details: { order_id: request.order_id } } };
      await this.store(request, 402, body, 'cancelled');
      return { status: 402, body };
    }

    const lines = request.items.map((i: any) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price_minor: prices.get(i.variant_id)! }));
    const subtotal = lines.reduce((s: number, l: any) => s + l.unit_price_minor * l.quantity, 0);
    const discount = Math.floor((subtotal * percent) / 100);
    const total = subtotal - discount;
    const paid_at = nowIso();
    const payload = {
      order_id: request.order_id, customer_id: request.customer_id, items: lines,
      subtotal_minor: subtotal, discount_minor: discount, total_minor: total, currency: 'PKR', paid_at,
    };
    const pdf = await receiptPdf(payload);
    await this.db.tx(async (c) => {
      for (const i of items) await c.query('UPDATE inventory SET reserved = reserved - $2 WHERE variant_id = $1', [i.variant_id, i.quantity]);
    });
    const suffix = randomUUID().slice(0, 8);
    const body = {
      order_id: request.order_id, status: 'paid', currency: 'PKR', items: lines,
      subtotal_minor: subtotal, discount_minor: discount, total_minor: total,
      payment: { authorization_id: `auth_${suffix}`, capture_id: `cap_${suffix}`, state: 'captured' },
      receipt: { payload, signature: sign(request.order_id, payload), pdf_base64: pdf.toString('base64') },
    };
    await this.store(request, 201, body, 'paid');
    await this.events.emit('order.status_changed', { order_id: request.order_id, from: 'pending', to: 'paid' });
    return { status: 201, body };
  }

  private async store(request: any, status: number, body: any, state: string) {
    await this.db.put('order', request.order_id, { request, state, status, body });
  }

  private async replay(request: any, wait = false): Promise<CheckoutResult | null> {
    for (let i = 0; i < (wait ? 50 : 1); i++) {
      const o = await this.db.get('order', request.order_id);
      if (!o) return null;
      if (canonical(o.request) !== canonical(request))
        throw conflict('DUPLICATE_ORDER_ID', `Order ${request.order_id} was already used with a different body.`, { order_id: request.order_id });
      if (o.state !== 'pending') return { status: o.status === 201 ? 200 : o.status, body: o.body };
      if (!wait) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  async inventory(variantId: string) {
    const r = await this.db.query('SELECT stock, reserved FROM inventory WHERE variant_id=$1', [variantId]);
    if (!r.rowCount) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} does not exist.`, { variant_id: variantId });
    return { variant_id: variantId, stock: r.rows[0].stock, reserved: r.rows[0].reserved };
  }
}
