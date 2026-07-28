import { describe, expect, it } from 'vitest';
import { shippingQuote, zoneForCP } from '../src/lib/shipping';
import type { ShippingConfig } from '../src/domain/catalog';

/**
 * Shipping is charged from the postal code, and the server recomputes it when the
 * order is placed. Both sides must classify a CP identically or the customer sees
 * one price and gets charged another.
 */

const CFG: ShippingConfig = { enabled: true, peninsula: 4.95, baleares: 8.95, freeThreshold: 30, info: '' };

describe('zoneForCP', () => {
  it('classifies the mainland', () => {
    expect(zoneForCP('28001')).toBe('peninsula'); // Madrid
    expect(zoneForCP('08001')).toBe('peninsula'); // Barcelona
    expect(zoneForCP('41001')).toBe('peninsula'); // Sevilla
  });

  it('classifies Baleares', () => {
    expect(zoneForCP('07001')).toBe('baleares');
    expect(zoneForCP('07800')).toBe('baleares');
  });

  it('refuses Canarias', () => {
    expect(zoneForCP('35001')).toBe('noservido'); // Las Palmas
    expect(zoneForCP('38001')).toBe('noservido'); // Tenerife
  });

  it('treats Ceuta and Melilla as mainland', () => {
    expect(zoneForCP('51001')).toBe('peninsula');
    expect(zoneForCP('52001')).toBe('peninsula');
  });

  it('returns null for anything that is not a postal code', () => {
    expect(zoneForCP('')).toBeNull();
    expect(zoneForCP('abc')).toBeNull();
    expect(zoneForCP('7')).toBeNull();
    expect(zoneForCP('A7001')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(zoneForCP('  07001 ')).toBe('baleares');
  });
});

describe('shippingQuote', () => {
  it('charges the mainland rate and reports what is missing for free shipping', () => {
    const q = shippingQuote(CFG, '28001', 10);
    expect(q.allowed).toBe(true);
    expect(q.cost).toBeCloseTo(4.95, 10);
    expect(q.free).toBe(false);
    expect(q.toFree).toBeCloseTo(20, 10);
  });

  it('charges the islands rate', () => {
    expect(shippingQuote(CFG, '07001', 10).cost).toBeCloseTo(8.95, 10);
  });

  it('ships free once the threshold is reached', () => {
    const q = shippingQuote(CFG, '28001', 30);
    expect(q.free).toBe(true);
    expect(q.cost).toBe(0);
    expect(q.toFree).toBe(0);
  });

  it('ships free above the threshold too', () => {
    expect(shippingQuote(CFG, '07001', 100).cost).toBe(0);
  });

  it('never ships free when there is no threshold configured', () => {
    const noFree: ShippingConfig = { ...CFG, freeThreshold: 0 };
    const q = shippingQuote(noFree, '28001', 10000);
    expect(q.free).toBe(false);
    expect(q.cost).toBeCloseTo(4.95, 10);
    expect(q.toFree).toBe(0);
  });

  it('refuses unserved and invalid destinations', () => {
    for (const cp of ['35001', '38001', 'xxx', '']) {
      const q = shippingQuote(CFG, cp, 50);
      expect(q.allowed, cp).toBe(false);
      expect(q.cost, cp).toBe(0);
    }
  });

  it('rounds the amount left for free shipping to cents', () => {
    expect(shippingQuote(CFG, '28001', 10.005).toFree).toBeCloseTo(19.99, 10);
  });
});
