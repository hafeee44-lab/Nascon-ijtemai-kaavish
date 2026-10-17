import { conflict, validationError } from '../common/api-error.js';

// FR-2.3 order lifecycle. Every accepted transition emits a domain event; cancelling or
// refunding returns the units to stock.
export const ORDER_STATES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const NEXT: Record<OrderState, OrderState[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function transition(from: OrderState, to: unknown): { to: OrderState; restock: boolean } {
  if (typeof to !== 'string' || !ORDER_STATES.includes(to as OrderState)) throw validationError(['status']);
  if (!NEXT[from].includes(to as OrderState))
    throw conflict('ILLEGAL_TRANSITION', `An order cannot go from ${from} to ${to}.`, { from, to, allowed: NEXT[from] });
  return { to: to as OrderState, restock: to === 'cancelled' || to === 'refunded' };
}

export const allowedNext = (from: OrderState) => NEXT[from];
