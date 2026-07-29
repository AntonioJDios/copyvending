import { describe, expect, it } from 'vitest';
import { decideNotification } from '../api/redsys-notify';

/**
 * The Redsys notification is the only thing (besides an admin) that may mark an
 * order as paid, so it is where a mistake costs real money in both directions:
 * marking a cheap payment as covering an expensive order, or refusing a good one.
 *
 * Verifying the signature only proves the message came from Redsys — not that it
 * authorises what we think. These tests pin the three checks that come after.
 */

const order = (total: number, paid = false) => ({ total, paid });
const notif = (over: Record<string, string> = {}) => ({
  Ds_Response: '0000',
  Ds_Currency: '978',
  Ds_Amount: '1000', // 10,00 €
  Ds_Order: '123456789012',
  Ds_AuthorisationCode: '654321',
  ...over,
});

describe('decideNotification — authorisation', () => {
  it('pays when authorised, in euros, for the right amount', () => {
    expect(decideNotification(notif(), order(10))).toEqual({ pay: true, reason: 'autorizado' });
  });

  it('accepts the whole authorised range 0000-0099', () => {
    for (const c of ['0000', '0001', '0050', '0099']) {
      expect(decideNotification(notif({ Ds_Response: c }), order(10)).pay, c).toBe(true);
    }
  });

  it('refuses anything outside that range (a denial is not a payment)', () => {
    for (const c of ['0100', '0101', '0184', '0190', '9999']) {
      const d = decideNotification(notif({ Ds_Response: c }), order(10));
      expect(d.pay, c).toBe(false);
      expect(d.reason).toMatch(/denegado/);
    }
  });

  it('refuses a missing or non-numeric response code', () => {
    expect(decideNotification(notif({ Ds_Response: '' }), order(10)).pay).toBe(false);
    expect(decideNotification(notif({ Ds_Response: 'OK' }), order(10)).pay).toBe(false);
  });
});

describe('decideNotification — amount (the check that was missing)', () => {
  it('REFUSES a notification for less than the order total', () => {
    // A 1 € notification must never settle a 300 € order.
    const d = decideNotification(notif({ Ds_Amount: '100' }), order(300));
    expect(d.pay).toBe(false);
    expect(d.reason).toMatch(/importe distinto/);
  });

  it('refuses a notification for more than the order total too', () => {
    expect(decideNotification(notif({ Ds_Amount: '5000' }), order(10)).pay).toBe(false);
  });

  it('compares in cents, tolerating float totals', () => {
    expect(decideNotification(notif({ Ds_Amount: '1099' }), order(10.99)).pay).toBe(true);
    expect(decideNotification(notif({ Ds_Amount: '3' }), order(0.03)).pay).toBe(true);
    // 0.1 + 0.2 style float noise must not break a legitimate payment
    expect(decideNotification(notif({ Ds_Amount: '30' }), order(0.1 + 0.2)).pay).toBe(true);
  });

  it('refuses a missing or non-numeric amount', () => {
    expect(decideNotification(notif({ Ds_Amount: '' }), order(10)).pay).toBe(false);
    expect(decideNotification(notif({ Ds_Amount: 'mucho' }), order(10)).pay).toBe(false);
  });
});

describe('decideNotification — currency', () => {
  it('refuses a currency other than EUR', () => {
    const d = decideNotification(notif({ Ds_Currency: '840' }), order(10)); // USD
    expect(d.pay).toBe(false);
    expect(d.reason).toMatch(/moneda/);
  });

  it('tolerates the field being absent (older notifications)', () => {
    const n = notif();
    delete (n as Record<string, string>).Ds_Currency;
    expect(decideNotification(n, order(10)).pay).toBe(true);
  });
});

describe('decideNotification — idempotency', () => {
  it('does not re-apply to an order that is already paid', () => {
    // Redsys retries until it gets a 200, so duplicates are normal, not an anomaly.
    const d = decideNotification(notif(), order(10, true));
    expect(d.pay).toBe(false);
    expect(d.reason).toMatch(/ya estaba pagado/);
  });

  it('checks the amount before idempotency, so a wrong amount is reported as such', () => {
    const d = decideNotification(notif({ Ds_Amount: '100' }), order(10, true));
    expect(d.reason).toMatch(/importe distinto/);
  });
});

describe('decideNotification — unknown order', () => {
  it('refuses a notification for an order that does not exist', () => {
    const d = decideNotification(notif(), null);
    expect(d.pay).toBe(false);
    expect(d.reason).toMatch(/no encontrado/);
  });
});
