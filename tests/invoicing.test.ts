import { describe, expect, it } from 'vitest';
import { DEFAULT_VAT_PERCENT, vatRateOf } from '../src/domain/catalog';
import { splitVat } from '../src/lib/stats';

/**
 * The VAT rate used to be hardcoded at 21% in two files. It is now the shop's own
 * setting, so the fallback behaviour matters: a missing or nonsense value must
 * never produce a rate of 0 (which would silently report no VAT owed at all in
 * the quarterly summary).
 */

describe('vatRateOf', () => {
  it('uses the shop-configured rate', () => {
    expect(vatRateOf({ enabled: true, vatPercent: 21 })).toBeCloseTo(0.21, 10);
    expect(vatRateOf({ enabled: true, vatPercent: 4 })).toBeCloseTo(0.04, 10);
    expect(vatRateOf({ enabled: true, vatPercent: 10 })).toBeCloseTo(0.1, 10);
  });

  it('accepts an explicit 0 (exempt)', () => {
    expect(vatRateOf({ enabled: true, vatPercent: 0 })).toBe(0);
  });

  it('falls back to the general rate when unset, not to zero', () => {
    expect(vatRateOf(undefined)).toBeCloseTo(DEFAULT_VAT_PERCENT / 100, 10);
    expect(vatRateOf({ enabled: true })).toBeCloseTo(DEFAULT_VAT_PERCENT / 100, 10);
  });

  it('ignores impossible values instead of trusting them', () => {
    expect(vatRateOf({ enabled: true, vatPercent: NaN })).toBeCloseTo(DEFAULT_VAT_PERCENT / 100, 10);
    expect(vatRateOf({ enabled: true, vatPercent: -5 })).toBeCloseTo(DEFAULT_VAT_PERCENT / 100, 10);
    expect(vatRateOf({ enabled: true, vatPercent: 'mucho' as unknown as number })).toBeCloseTo(DEFAULT_VAT_PERCENT / 100, 10);
  });
});

describe('splitVat', () => {
  it('splits a VAT-inclusive amount into base + VAT', () => {
    // 121 € con IVA al 21% → base 100, cuota 21
    const { base, vat } = splitVat(121, 0.21);
    expect(base).toBeCloseTo(100, 8);
    expect(vat).toBeCloseTo(21, 8);
  });

  it('always adds back up to the gross amount', () => {
    for (const gross of [0, 0.01, 9.99, 1234.56]) {
      for (const rate of [0, 0.04, 0.1, 0.21]) {
        const { base, vat } = splitVat(gross, rate);
        expect(base + vat).toBeCloseTo(gross, 8);
      }
    }
  });

  it('reports no VAT when the rate is 0', () => {
    const { base, vat } = splitVat(100, 0);
    expect(base).toBeCloseTo(100, 10);
    expect(vat).toBeCloseTo(0, 10);
  });

  it('honours a rate other than the default', () => {
    // The whole point of making it configurable: 10% must not be split as 21%.
    expect(splitVat(110, 0.1).base).toBeCloseTo(100, 8);
    expect(splitVat(110, 0.21).base).not.toBeCloseTo(100, 2);
  });
});
