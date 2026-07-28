import { describe, expect, it } from 'vitest';
import { couponDiscount, couponLabel } from '../src/domain/coupons';

/**
 * A coupon bug is money out of the till. The discount is recomputed server-side
 * when the order is placed, so this arithmetic has to hold on both sides — most
 * importantly the two safety rails: never negative, never above the subtotal.
 */

describe('couponDiscount', () => {
  it('takes a percentage off the subtotal', () => {
    expect(couponDiscount({ type: 'percent', value: 10 }, 25)).toBeCloseTo(2.5, 10);
    expect(couponDiscount({ type: 'percent', value: 50 }, 10)).toBeCloseTo(5, 10);
  });

  it('takes a fixed amount off', () => {
    expect(couponDiscount({ type: 'fixed', value: 5 }, 25)).toBeCloseTo(5, 10);
  });

  it('never discounts more than the subtotal (no negative totals, no refunds)', () => {
    expect(couponDiscount({ type: 'fixed', value: 50 }, 10)).toBeCloseTo(10, 10);
    expect(couponDiscount({ type: 'percent', value: 150 }, 10)).toBeCloseTo(10, 10);
  });

  it('never returns a negative discount', () => {
    expect(couponDiscount({ type: 'fixed', value: -5 }, 10)).toBe(0);
    expect(couponDiscount({ type: 'percent', value: -10 }, 10)).toBe(0);
  });

  it('rounds to whole cents', () => {
    // 13.33 × 15% = 1.9995 → 2.00
    expect(couponDiscount({ type: 'percent', value: 15 }, 13.33)).toBeCloseTo(2, 10);
    // 0.333 × 10% = 0.0333 → 0.03
    expect(couponDiscount({ type: 'percent', value: 10 }, 0.333)).toBeCloseTo(0.03, 10);
  });

  it('discounts nothing on an empty cart', () => {
    expect(couponDiscount({ type: 'percent', value: 10 }, 0)).toBe(0);
    expect(couponDiscount({ type: 'fixed', value: 10 }, 0)).toBe(0);
  });

  it('treats a missing or non-numeric value as no discount', () => {
    expect(couponDiscount({ type: 'percent', value: NaN }, 10)).toBe(0);
    expect(couponDiscount({ type: 'fixed', value: undefined as unknown as number }, 10)).toBe(0);
  });
});

describe('couponLabel', () => {
  it('shows percentages as-is and amounts in euros with a comma', () => {
    expect(couponLabel({ type: 'percent', value: 10 })).toBe('10%');
    expect(couponLabel({ type: 'fixed', value: 5 })).toBe('5,00 €');
    expect(couponLabel({ type: 'fixed', value: 2.5 })).toBe('2,50 €');
  });
});
