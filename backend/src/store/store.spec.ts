import { ApiError } from '../common/api-error.js';
import { sign } from '../common/canonical.js';
import { FakeDb } from '../test/fake-db.js';
import { StoreService } from './store.service.js';

const setup = (stock = 1) => {
  const db = new FakeDb();
  db.put('variant', 'v-M', { variant_id: 'v-M', price_minor: 450000, currency: 'PKR' });
  db.put('discount', 'WELCOME10', { code: 'WELCOME10', percent: 10 });
  db.inventory.set('v-M', { stock, reserved: 0 });
  const emitted: any[] = [];
  const svc = new StoreService(db as any, { emit: async (t: string, d: any) => { emitted.push([t, d]); } } as any);
  return { db, svc, emitted };
};
const order = (id: string, extra: Record<string, any> = {}) => ({
  order_id: id, customer_id: 'c1', items: [{ variant_id: 'v-M', quantity: 1 }], discount_code: null, payment: { token: 'tok_success' }, ...extra,
});
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ApiError).code; } };

describe('store checkout (NFR-3)', () => {
  it('sells the last unit exactly once under 20 concurrent buyers', async () => {
    const { svc, db } = setup(1);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => svc.checkout(order(`o${i}`))));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected' && (r.reason as ApiError).code === 'OUT_OF_STOCK').length).toBe(19);
    expect(await svc.inventory('v-M')).toEqual({ variant_id: 'v-M', stock: 0, reserved: 0 });
    expect(db.inventory.get('v-M')!.stock).toBe(0);
  });

  it('signs the receipt, produces a PDF, applies the discount and emits a domain event', async () => {
    const { svc, emitted } = setup(5);
    const r = await svc.checkout(order('o1', { items: [{ variant_id: 'v-M', quantity: 2 }], discount_code: 'WELCOME10' }));
    expect(r.status).toBe(201);
    expect([r.body.subtotal_minor, r.body.discount_minor, r.body.total_minor]).toEqual([900000, 90000, 810000]);
    expect(r.body.receipt.signature).toBe(sign('o1', r.body.receipt.payload));
    expect(Buffer.from(r.body.receipt.pdf_base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(emitted[0][0]).toBe('order.status_changed');
    const again = await svc.checkout(order('o1', { items: [{ variant_id: 'v-M', quantity: 2 }], discount_code: 'WELCOME10' }));
    expect(again.status).toBe(200);
    expect(await code(svc.checkout(order('o1')))).toBe('DUPLICATE_ORDER_ID');
  });

  it('releases stock on declined and failed capture, and validates input', async () => {
    const { svc } = setup(1);
    expect((await svc.checkout(order('d1', { payment: { token: 'tok_declined' } }))).status).toBe(402);
    expect((await svc.checkout(order('d2', { payment: { token: 'tok_capture_fail' } }))).body.error.code).toBe('PAYMENT_CAPTURE_FAILED');
    expect(await svc.inventory('v-M')).toEqual({ variant_id: 'v-M', stock: 1, reserved: 0 });
    expect(await code(svc.checkout(order('x', { discount_code: 'NOPE' })))).toBe('INVALID_DISCOUNT_CODE');
    expect(await code(svc.checkout(order('x', { items: [{ variant_id: 'nope', quantity: 1 }] })))).toBe('VARIANT_NOT_FOUND');
    expect(await code(svc.checkout({ order_id: 'x', items: [] }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.checkout('bad' as any))).toBe('VALIDATION_ERROR');
    expect(await code(svc.inventory('nope'))).toBe('VARIANT_NOT_FOUND');
  });
});
