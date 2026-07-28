import { describe, expect, it } from 'vitest';
import { orderStateFrom } from '../api/orders';

/**
 * Regression tests for a payment bypass found in audit (2026-07-28).
 *
 * The server recomputed the PRICE but inserted `paid` / `payment_method` /
 * `status` exactly as the browser sent them. So `POST /api/orders` with
 * `{"paid": true}` produced an order shown as "💶 Pagado" in the backoffice — and
 * home delivery is prepaid, so the shop would print a GLS label and ship it
 * without a cent arriving.
 *
 * The rule now: payment state is the shop's to declare, never the customer's.
 */

const customerSays = (body: Record<string, unknown>) => orderStateFrom(body, false);
const shopSays = (body: Record<string, unknown>) => orderStateFrom(body, true);

describe('orderStateFrom — customer requests', () => {
  it('IGNORES a customer claiming the order is paid', () => {
    const s = customerSays({ paid: true, paymentMethod: 'redsys', status: 'entregado' });
    expect(s.paid).toBe(false);
    expect(s.status).toBe('nuevo');
  });

  it('ignores every truthy shape of the flag', () => {
    for (const paid of [true, 1, 'true', 'yes', {}, []]) {
      expect(orderStateFrom({ paid }, false).paid, JSON.stringify(paid)).toBe(false);
    }
  });

  it('never lets the customer advance the order status', () => {
    for (const status of ['en_proceso', 'listo', 'entregado']) {
      expect(customerSays({ status }).status, status).toBe('nuevo');
    }
  });

  it('keeps the chosen payment method as a mere intent', () => {
    // Useful in the backoffice ("is going to pay by card") and harmless: what
    // gates delivery is `paid`, which stays false.
    expect(customerSays({ paymentMethod: 'redsys' })).toEqual({ paid: false, paymentMethod: 'redsys', status: 'nuevo' });
    expect(customerSays({ paymentMethod: 'local' }).paymentMethod).toBe('local');
  });

  it('rejects an unknown payment method instead of storing junk', () => {
    for (const m of ['gratis', 'bitcoin', '', 42, null, { local: true }]) {
      expect(orderStateFrom({ paymentMethod: m }, false).paymentMethod, JSON.stringify(m)).toBeNull();
    }
  });

  it('defaults to unpaid + new for an empty body', () => {
    expect(customerSays({})).toEqual({ paid: false, paymentMethod: null, status: 'nuevo' });
  });
});

describe('orderStateFrom — the shop itself (admin token)', () => {
  it('may mark an order paid (cash at the counter)', () => {
    expect(shopSays({ paid: true, paymentMethod: 'local' })).toEqual({ paid: true, paymentMethod: 'local', status: 'nuevo' });
  });

  it('may set a known status', () => {
    expect(shopSays({ status: 'listo' }).status).toBe('listo');
  });

  it('still refuses an invented status', () => {
    expect(shopSays({ status: 'pagado_a_medias' }).status).toBe('nuevo');
  });

  it('only treats a real boolean true as paid', () => {
    expect(shopSays({ paid: 'true' }).paid).toBe(false);
    expect(shopSays({ paid: 1 }).paid).toBe(false);
  });

  it('creates unpaid orders by default (email ingestion sends no payment state)', () => {
    expect(shopSays({})).toEqual({ paid: false, paymentMethod: null, status: 'nuevo' });
  });
});
