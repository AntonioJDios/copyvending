import { describe, expect, it } from 'vitest';
import { newOrderCode } from '../src/lib/orderCode';

/**
 * Order codes used to be derived from Date.now(), which made them guessable — and
 * the code is what a customer presents to look their order up. These tests pin
 * the two properties that matter: unguessable, and readable out loud.
 */

// 2-9 and A-Z minus the look-alikes I and O.
const VALID = /^P-[2-9A-HJ-NP-Z]{8}$/;

describe('newOrderCode', () => {
  it('has the expected shape', () => {
    expect(newOrderCode()).toMatch(VALID);
  });

  it('never contains characters people confuse when reading them out', () => {
    const codes = Array.from({ length: 500 }, newOrderCode).join('');
    for (const bad of ['0', 'O', '1', 'I']) {
      expect(codes.includes(bad), `contiene "${bad}"`).toBe(false);
    }
  });

  it('is not derived from the clock: consecutive codes share no prefix', () => {
    const a = newOrderCode();
    const b = newOrderCode();
    expect(a).not.toBe(b);
    // A time-based code would keep the leading characters identical.
    expect(a.slice(2, 6)).not.toBe(b.slice(2, 6));
  });

  it('does not collide over a realistic number of orders', () => {
    const n = 20000;
    const seen = new Set(Array.from({ length: n }, newOrderCode));
    expect(seen.size).toBe(n);
  });

  it('uses the whole alphabet (not stuck on a few characters)', () => {
    const chars = new Set(Array.from({ length: 2000 }, newOrderCode).join('').replace(/P-/g, ''));
    expect(chars.size).toBe(32);
  });
});
